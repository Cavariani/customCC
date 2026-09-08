import express from 'express'
import { writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { WebSocketServer, type WebSocket } from 'ws'
import { DEFAULT_CWD, PORT, expandHome, resolveClaudeBin } from './config.js'
import { readGitState } from './git.js'
import { backupContentFor, readChanges } from './changes.js'
import { listHunks, stageHunk, unstageHunk } from './hunks.js'
import {
  checkoutFile,
  commit,
  insideCwd,
  isConflicted,
  isTracked,
  stage,
  unstage,
} from './gitwrite.js'
import {
  ACCOUNT_IDS,
  getActiveAccountId,
  getAutoSwitch,
  periodosRecentes,
  proximaContaDisponivel,
  setAutoSwitch,
  clearRateLimited,
  markRateLimited,
  setActiveAccountId,
  summarizeAccounts,
  tokenFor,
  type AccountId,
} from './accounts.js'
import { resolveNow, startDiscovery, stopDiscovery } from './discovery.js'
import { listRecentProjects } from './projects.js'
import { onLimitEvent, watchSession } from './watcher.js'
import { SILENCIO_MS, detectActivity } from './activity.js'
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
app.use(express.json({ limit: '2mb' }))

/**
 * Corpo que nao e JSON valido nao pode derrubar o servidor. Sem este
 * tratador o erro do body-parser sobe como excecao nao capturada e o
 * processo morre: com o servico em KeepAlive isso reaparecia como uma
 * queda silenciosa no meio do trabalho.
 */
app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'corpo nao e JSON valido' })
  }
  // Corpo acima do limite do body-parser tem resposta propria: 413 diz que o
  // pedido era grande demais, enquanto o 500 generico acusava falha nossa e
  // mandava procurar bug no servidor.
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'corpo grande demais para esta rota' })
  }
  if (error) {
    console.error('[customcc] erro nao tratado:', error)
    return res.status(500).json({ error: 'erro interno' })
  }
  next()
})

const claudeBin = resolveClaudeBin()

/**
 * A versao e enfeite: aparece nos ajustes e mais nada. Mas a chamada e
 * sincrona e acontece antes do listen, entao um binario que demora responder
 * segura o servidor inteiro no ar sem escutar porta nem imprimir uma linha —
 * de fora, indistinguivel de um processo travado. O timeout troca o enfeite
 * por "desconhecida" e deixa o painel subir.
 */
const claudeVersion = (() => {
  try {
    return execFileSync(claudeBin, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      killSignal: 'SIGKILL',
    }).trim()
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

app.get('/api/projects', async (_req, res) => {
  try {
    res.json({ projects: await listRecentProjects() })
  } catch (error) {
    res.status(500).json({ error: String(error) })
  }
})

// Valida um caminho digitado a mao antes de abrir uma aba nele.
app.get('/api/resolve-path', (req, res) => {
  const raw = typeof req.query.path === 'string' ? req.query.path.trim() : ''
  if (!raw) return res.status(400).json({ error: 'caminho vazio' })
  const cwd = expandHome(raw)
  if (!existsSync(cwd)) return res.json({ ok: false, cwd, reason: 'nao existe' })
  if (!statSync(cwd).isDirectory()) return res.json({ ok: false, cwd, reason: 'nao e uma pasta' })
  res.json({ ok: true, cwd, name: cwd.split(/[/\\]/).filter(Boolean).pop() ?? cwd })
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

/**
 * Escrita exige cwd explicito. Cair no diretorio padrao do servidor
 * significaria que uma chamada malformada, ou qualquer processo local,
 * commitaria ou sobrescreveria arquivo no projeto errado sem ninguem ter
 * pedido. Leitura pode ter padrao; escrita nao.
 */
function bodyCwd(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('cwd obrigatorio nesta rota')
  }
  const cwd = expandHome(value)
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`pasta invalida: ${cwd}`)
  }
  return cwd
}

/**
 * Campo de texto vindo do corpo. `String(valor)` aceitava qualquer coisa:
 * um objeto virava a mensagem de commit "[object Object]" e uma lista
 * virava "a,b" — os dois entravam no historico como se fossem o que o
 * Pedro digitou. Aqui o tipo errado vira erro, nao texto inventado.
 */
function bodyText(value: unknown, campo: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${campo} precisa ser texto`)
  if (value.includes('\0')) throw new Error(`${campo} com byte nulo`)
  const text = value.trim()
  if (!text) throw new Error(`${campo} nao pode ficar vazio`)
  if (text.length > max) throw new Error(`${campo} passa do limite: ${text.length} caracteres`)
  return text
}

/** Teto da mensagem de commit: acima disso e colagem acidental. */
const MAX_MESSAGE = 20000

app.post('/api/git/stage', async (req, res) => {
  try {
    await stage(bodyCwd(req.body?.cwd), req.body?.paths ?? [])
    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) })
  }
})

app.post('/api/git/unstage', async (req, res) => {
  try {
    await unstage(bodyCwd(req.body?.cwd), req.body?.paths ?? [])
    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) })
  }
})

/**
 * Blocos de um arquivo, para o painel poder mover um pedaco de cada vez.
 * `staged=1` lista o que ja esta no indice, que e o lado do desfazer.
 */
app.get('/api/git/hunks', async (req, res) => {
  try {
    const cwd = bodyCwd(req.query.cwd)
    const path = bodyText(req.query.path, 'caminho', 4096)
    if (!insideCwd(cwd, path)) {
      return res.status(400).json({ error: `caminho fora do projeto: ${path}` })
    }
    const diff = await listHunks(cwd, path, req.query.staged === '1')
    res.json({ hunks: diff.hunks })
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) })
  }
})

/** Move um bloco para o indice, ou tira de la, sem tocar no resto do arquivo. */
async function rotaDeBloco(req: express.Request, res: express.Response, tirar: boolean) {
  try {
    const cwd = bodyCwd(req.body?.cwd)
    const path = bodyText(req.body?.path, 'caminho', 4096)
    if (!insideCwd(cwd, path)) {
      return res.status(400).json({ error: `caminho fora do projeto: ${path}` })
    }
    const index = req.body?.index
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
      return res.status(400).json({ error: 'index precisa ser inteiro nao negativo' })
    }
    if (tirar) await unstageHunk(cwd, path, index)
    else await stageHunk(cwd, path, index)
    res.json({ ok: true })
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) })
  }
}

app.post('/api/git/stage-hunk', (req, res) => void rotaDeBloco(req, res, false))
app.post('/api/git/unstage-hunk', (req, res) => void rotaDeBloco(req, res, true))

app.post('/api/git/commit', async (req, res) => {
  try {
    const result = await commit(
      bodyCwd(req.body?.cwd),
      bodyText(req.body?.message, 'mensagem', MAX_MESSAGE),
      Boolean(req.body?.all),
    )
    res.json({ ok: true, ...result })
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) })
  }
})

/**
 * Desfaz as mudancas de um arquivo. Prefere o backup da sessao, que existe
 * mesmo para arquivo que o git nunca viu; sem backup, volta ao HEAD. Nao
 * apaga arquivo novo: sumir com o trabalho de alguem nao e "reverter".
 */
app.post('/api/changes/revert', async (req, res) => {
  let cwd: string
  try {
    cwd = bodyCwd(req.body?.cwd)
  } catch (error) {
    return res.status(400).json({ error: String(error instanceof Error ? error.message : error) })
  }

  let path: string
  try {
    path = bodyText(req.body?.path, 'caminho', 4096)
  } catch (error) {
    return res.status(400).json({ error: String(error instanceof Error ? error.message : error) })
  }
  if (!insideCwd(cwd, path)) {
    return res.status(400).json({ error: `caminho fora do projeto: ${path}` })
  }

  try {
    // Num conflito aberto, o `checkout HEAD -- arquivo` nao reverte: ele
    // escolhe o nosso lado e marca o conflito como resolvido, apagando o
    // outro lado sem avisar. Medido no laboratorio: o arquivo voltava para
    // a versao de HEAD, o status ficava limpo e o MERGE_HEAD seguia aberto.
    if (await isConflicted(cwd, path)) {
      return res.status(400).json({
        error: 'arquivo em conflito: reverter aqui escolheria um lado e marcaria como resolvido',
      })
    }

    const backup = await backupContentFor(cwd, path)
    if (backup !== null) {
      // join, nao concatenacao: no Windows a barra invertida quebraria e um
      // caminho ja absoluto viraria "cwd/-Users-...".
      await writeFile(resolvePath(cwd, path), backup, 'utf8')
      return res.json({ ok: true, source: 'file-history' })
    }
    if (await isTracked(cwd, path)) {
      await checkoutFile(cwd, path)
      return res.json({ ok: true, source: 'git' })
    }
    res.status(400).json({
      error: 'arquivo novo e sem backup da sessao: reverter aqui seria apagar',
    })
  } catch (error) {
    res.status(400).json({ error: String(error instanceof Error ? error.message : error) })
  }
})

app.get('/api/accounts', async (_req, res) => {
  try {
    res.json({
      accounts: await summarizeAccounts(),
      activeId: await getActiveAccountId(),
      periods: await periodosRecentes(),
    })
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
/**
 * Passa todas as abas para outra conta, retomando cada conversa.
 *
 * Vive fora da rota porque a troca tem dois gatilhos: o clique no painel e
 * o limite batendo sozinho. Duplicar isso significaria que so um dos dois
 * caminhos ganharia as correcoes.
 */
async function trocarPara(id: AccountId, motivo?: string) {
  await setActiveAccountId(id)
  const token = await tokenFor(id)
  const summaries = await summarizeAccounts()
  const label = summaries.find((a) => a.id === id)?.label ?? `conta ${id}`
  const prefixo = motivo ? `${motivo} · ` : ''
  const notice = token
    ? `${prefixo}conta ${id} (${label}) ativa, retomando a conversa desta aba`
    : `${prefixo}conta ${id} (${label}) selecionada, mas sem token valido: o processo voltou na credencial ambiente`

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

  return {
    accounts: await summarizeAccounts(),
    activeId: id,
    restarted,
    resumed,
    usedToken: Boolean(token),
  }
}

app.post('/api/accounts/:id/activate', async (req, res) => {
  const id = parseAccountId(req.params.id)
  if (id === null) return res.status(400).json({ error: 'conta invalida' })
  res.json(await trocarPara(id))
})

app.get('/api/auto-switch', async (_req, res) => {
  res.json({ enabled: await getAutoSwitch() })
})

app.post('/api/auto-switch', async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled precisa ser booleano' })
  }
  await setAutoSwitch(req.body.enabled)
  res.json({ enabled: await getAutoSwitch() })
})

/**
 * Uma troca automatica de cada vez. A TUI redesenha a tela varias vezes com
 * a mesma mensagem de limite, e sem esta trava o detector dispararia uma
 * troca em cima da outra, cada uma derrubando os processos da anterior.
 */
let trocandoSozinho = false

onLimitEvent(({ signal, accountId }) => {
  console.log(`[customcc] limite ${signal.kind} na conta ${accountId}: ${signal.evidence}`)
  if (signal.kind !== 'reached') return

  void (async () => {
    if (trocandoSozinho) return
    if (!(await getAutoSwitch())) {
      console.log('[customcc] troca automatica desligada; a conta fica como esta')
      return
    }
    // So troca se a conta que caiu e a que esta em uso: um alerta de conta
    // parada nao e motivo para mexer no que esta rodando.
    if ((await getActiveAccountId()) !== accountId) return

    const proxima = await proximaContaDisponivel(accountId)
    if (proxima === null) {
      console.log('[customcc] limite atingido e nenhuma outra conta disponivel')
      return
    }

    trocandoSozinho = true
    try {
      console.log(`[customcc] troca automatica: conta ${accountId} -> ${proxima}`)
      await trocarPara(proxima, 'limite atingido')
    } catch (erro) {
      console.error('[customcc] troca automatica falhou:', erro)
    } finally {
      trocandoSozinho = false
    }
  })()
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

/**
 * Move uma aba para outra pasta. Esta rota apenas encerra a sessao atual:
 * quem sobe o processo novo, ja na pasta nova, e a reconexao do WebSocket
 * do navegador. Chamar isto sozinho, de fora da UI, so mata a sessao.
 */
app.post('/api/sessions/:id/cwd', async (req, res) => {
  let cwd: string
  try {
    cwd = bodyCwd(req.body?.cwd)
  } catch (error) {
    return res.status(400).json({ error: String(error instanceof Error ? error.message : error) })
  }
  stopDiscovery(req.params.id)
  killSession(req.params.id)
  res.json({ ok: true, cwd })
})

// Fechar a aba no navegador encerra de proposito o `claude` daquela sessao.
app.delete('/api/sessions/:id', (req, res) => {
  stopDiscovery(req.params.id)
  killSession(req.params.id)
  res.json({ ok: true })
})

// Em producao o proprio servidor entrega o frontend buildado, para o uso
// diario nao depender do Vite rodando numa janela de terminal.
const here = dirname(fileURLToPath(import.meta.url))
const DIST = resolvePath(here, '..', 'dist')
if (existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get(/^(?!\/api|\/pty).*/, (_req, res) => res.sendFile(join(DIST, 'index.html')))
}

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

  send({ t: 'activity', state: session.activity })

  send({
    t: 'ready',
    session: id,
    pid: session.proc.pid,
    cwd: session.cwd,
    // Reconexao (reload da aba) repoe o que ja tinha rolado no terminal.
    reattached: Boolean(existing),
    replay: session.buffer,
  })

  // Cauda propria por socket: a TUI escreve em pedacos e o marcador de
  // estado pode nascer partido entre dois deles.
  let tail = ''
  let ultimoDado = 0
  let ocioso: ReturnType<typeof setTimeout> | null = null

  const anunciar = (state: 'working' | 'waiting' | 'idle') => {
    if (state === session.activity) return
    session.activity = state
    send({ t: 'activity', state })
  }

  const onData = (chunk: string) => {
    send({ t: 'data', data: chunk })
    tail = (tail + chunk).slice(-4000)

    const agora = Date.now()
    anunciar(detectActivity(tail, agora - ultimoDado))
    ultimoDado = agora

    // O silencio e o que marca o fim do trabalho, entao ele precisa de um
    // despertador proprio: nao chega mais nenhum pacote para reavaliar.
    if (ocioso) clearTimeout(ocioso)
    ocioso = setTimeout(() => anunciar(detectActivity(tail, SILENCIO_MS + 1)), SILENCIO_MS)
  }
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
    if (ocioso) clearTimeout(ocioso)
    session.listeners.delete(onData)
    session.exitListeners.delete(onExit)
  })
})

// So no loopback. Sem o host explicito o Node escuta em todas as
// interfaces, e qualquer um na mesma rede abriria um terminal com o Claude
// Code rodando nas contas do Pedro, sem senha nenhuma.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[customcc] servidor em http://localhost:${PORT} (apenas loopback)`)
  console.log(`[customcc] claude ${claudeVersion} em ${claudeBin}`)
  console.log(`[customcc] cwd padrao ${DEFAULT_CWD}`)
})

// Ultima rede: uma excecao solta em callback assincrono nao pode levar
// junto os processos `claude` que estao no meio de uma tarefa.
process.on('uncaughtException', (error) => {
  console.error('[customcc] excecao nao capturada:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('[customcc] promessa rejeitada sem tratamento:', reason)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    killAll()
    process.exit(0)
  })
}
