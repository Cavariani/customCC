import express from 'express'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { WebSocketServer, type WebSocket } from 'ws'
import { DEFAULT_CWD, PORT, expandHome, resolveClaudeBin } from './config.js'
import { readGitState } from './git.js'
import { readChanges } from './changes.js'
import {
  ACCOUNT_IDS,
  getActiveAccountId,
  clearRateLimited,
  markRateLimited,
  setActiveAccountId,
  summarizeAccounts,
  tokenFor,
  type AccountId,
} from './accounts.js'
import { resolveNow, startDiscovery, stopDiscovery } from './discovery.js'
import { onLimitEvent, watchSession } from './watcher.js'
import {
  getSession,
  killAll,
  killSession,
  listSessions,
  resize,
  restartSession,
  startSession,
  write,
} from './pty.js'

const app = express()
app.use(express.json())

const claudeBin = resolveClaudeBin()
const claudeVersion = (() => {
  try {
    return execFileSync(claudeBin, ['--version'], { encoding: 'utf8' }).trim()
  } catch {
    return 'desconhecida'
  }
})()

app.get('/api/info', (_req, res) => {
  res.json({ defaultCwd: DEFAULT_CWD, claudeBin, claudeVersion })
})

app.get('/api/sessions', (_req, res) => {
  res.json({ sessions: listSessions() })
})

app.get('/api/git', async (req, res) => {
  const cwd = typeof req.query.cwd === 'string' ? expandHome(req.query.cwd) : DEFAULT_CWD
  try {
    res.json(await readGitState(cwd))
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.get('/api/changes', async (req, res) => {
  const cwd = typeof req.query.cwd === 'string' ? expandHome(req.query.cwd) : DEFAULT_CWD
  try {
    res.json(await readChanges(cwd))
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

app.get('/api/accounts', async (_req, res) => {
  try {
    res.json({ accounts: await summarizeAccounts(), activeId: await getActiveAccountId() })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

function parseAccountId(value: unknown): AccountId | null {
  const n = Number(value)
  return (ACCOUNT_IDS as readonly number[]).includes(n) ? (n as AccountId) : null
}

/**
 * Troca de conta: move o ponteiro de conta ativa e reinicia cada sessao de
 * `claude` com o token da conta nova, usando `--continue` para o transcript
 * retomar de onde parou. Sem token valido, a sessao volta a rodar na
 * credencial ambiente e dizemos isso em vez de fingir que trocou.
 */
app.post('/api/accounts/:id/activate', async (req, res) => {
  const id = parseAccountId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'conta invalida' })

  await setActiveAccountId(id)
  const token = await tokenFor(id)
  const summaries = await summarizeAccounts()
  const label = summaries.find((a) => a.id === id)?.label ?? `conta ${id}`
  const notice = token
    ? `conta ${id} (${label}) ativa, retomando com claude --continue`
    : `conta ${id} (${label}) selecionada, mas sem token valido: o processo voltou na credencial ambiente`

  const restarted: string[] = []
  const resumed: string[] = []
  for (const info of listSessions()) {
    // Ultima chance de descobrir a conversa da aba antes de derrubar o
    // processo: sem o id, a sessao volta limpa e o contexto se perde.
    if (!info.claudeSessionId) await resolveNow(info.id)

    const session = await restartSession(info.id, { token, notice })
    if (!session) continue
    restarted.push(info.id)
    if (session.claudeSessionId) resumed.push(info.id)
    // Com `--resume` a conversa segue no mesmo transcript; sem id, a sessao
    // nova precisa ser descoberta de novo.
    else void startDiscovery(info.id, session.cwd, session.startedAt)
  }

  res.json({
    accounts: await summarizeAccounts(),
    activeId: id,
    restarted,
    resumed,
    usedToken: Boolean(token),
  })
})

onLimitEvent(({ signal, accountId }) => {
  console.log(
    `[customcc] limite ${signal.kind} na conta ${accountId}: ${signal.evidence}`,
  )
})

app.post('/api/accounts/:id/rate-limited', async (req, res) => {
  const id = parseAccountId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'conta invalida' })
  await markRateLimited(id, { evidence: 'marcado manualmente nos ajustes' })
  res.json({ accounts: await summarizeAccounts() })
})

// Usado quando o alerta e um falso positivo, ou apos resolver na mao.
app.post('/api/accounts/:id/clear-limit', async (req, res) => {
  const id = parseAccountId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'conta invalida' })
  await clearRateLimited(id)
  res.json({ accounts: await summarizeAccounts() })
})

// Fechar a aba no navegador encerra de proposito o `claude` daquela sessao.
app.delete('/api/sessions/:id', (req, res) => {
  stopDiscovery(req.params.id)
  killSession(req.params.id)
  res.json({ ok: true })
})

const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/pty' })

type ClientMessage =
  | { t: 'input'; data: string }
  | { t: 'resize'; cols: number; rows: number }

wss.on('connection', async (socket: WebSocket, request) => {
  const url = new URL(request.url ?? '/pty', 'http://localhost')
  const id = url.searchParams.get('session')
  if (!id) {
    socket.close(1008, 'session obrigatorio')
    return
  }

  const cwd = url.searchParams.get('cwd') ?? undefined
  const cols = Number(url.searchParams.get('cols') ?? 100)
  const rows = Number(url.searchParams.get('rows') ?? 30)

  const existing = getSession(id)
  // Sessao nova precisa nascer ja na conta ativa: antes so o restart passava
  // o token, entao toda aba recem-aberta caia na credencial ambiente.
  const token = existing ? undefined : await tokenFor(await getActiveAccountId())
  const session = startSession({ id, cwd, cols, rows, token })
  const send = (payload: unknown) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
  }

  // Amarra a aba ao transcript que o `claude` vai abrir, para quota e diff.
  if (!existing) void startDiscovery(id, session.cwd, session.startedAt)
  // Fica de olho no output procurando os avisos de limite.
  watchSession(session)

  send({
    t: 'ready',
    session: id,
    pid: session.proc.pid,
    cwd: session.cwd,
    // Reconexao (reload da aba) repoe o que ja tinha rolado no terminal.
    reattached: Boolean(existing),
    replay: session.buffer,
  })

  const onData = (chunk: string) => send({ t: 'data', data: chunk })
  const onExit = (code: number) => send({ t: 'exit', code })
  session.listeners.add(onData)
  session.exitListeners.add(onExit)
  if (session.exited) send({ t: 'exit', code: session.exitCode ?? 0 })

  socket.on('message', (raw) => {
    let msg: ClientMessage
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    if (msg.t === 'input') write(id, msg.data)
    else if (msg.t === 'resize') resize(id, msg.cols, msg.rows)
  })

  socket.on('close', () => {
    // A sessao sobrevive ao socket de proposito: fechar a aba do navegador
    // nao pode matar o `claude` que esta no meio de uma tarefa.
    session.listeners.delete(onData)
    session.exitListeners.delete(onExit)
  })
})

server.listen(PORT, () => {
  console.log(`[customcc] servidor em http://localhost:${PORT}`)
  console.log(`[customcc] claude ${claudeVersion} em ${claudeBin}`)
  console.log(`[customcc] cwd padrao ${DEFAULT_CWD}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    killAll()
    process.exit(0)
  })
}
