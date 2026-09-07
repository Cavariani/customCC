import * as pty from 'node-pty'
import { realpathSync } from 'node:fs'
import { DEFAULT_CWD, IS_WINDOWS, expandHome, resolveClaudeBin } from './config.js'

/** Quanto de output guardamos por sessao para repor apos um reload. */
const REPLAY_LIMIT = 200_000

/**
 * Marcadores que o Claude Code injeta no ambiente dos processos que ele
 * mesmo cria. Se o servidor for iniciado de dentro de uma sessao, o `claude`
 * filho os herda, se declara sessao aninhada e desliga o transcript, que e
 * exatamente a fonte de dados de quota e diff. Cada aba precisa ser uma
 * sessao de primeira classe, entao limpamos os marcadores na largada.
 */
const INHERITED_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
]

export interface SessionOptions {
  id: string
  cwd?: string
  cols?: number
  rows?: number
  /** Passa `--continue` para retomar o transcript apos uma troca de conta. */
  resume?: boolean
  /** Token da conta ativa. Ausente = usa a credencial ambiente do usuario. */
  token?: string
}

type Listener = (chunk: string) => void
type ExitListener = (code: number, signal?: number) => void

export interface Session {
  id: string
  cwd: string
  /** Em que pe a sessao esta, inferido do que o `claude` desenha. */
  activity: 'working' | 'waiting' | 'idle'
  /**
   * Sessao do Claude Code que esta aba abriu, descoberta pelo transcript.
   * Guardar isso e o que permite retomar com `--resume <id>` em vez de
   * `--continue`, que pega a conversa mais recente do diretorio e pode ser
   * de outra aba, ou de um Claude Code aberto por fora.
   */
  claudeSessionId: string | null
  /** Trocado a cada restart; os listeners abaixo sobrevivem a troca. */
  proc: pty.IPty
  /** Output recente, reposto quando o navegador reconecta. */
  buffer: string
  listeners: Set<Listener>
  exitListeners: Set<ExitListener>
  exited: boolean
  exitCode: number | null
  startedAt: number
}

const sessions = new Map<string, Session>()

export function listSessions() {
  return [...sessions.values()].map((s) => ({
    id: s.id,
    cwd: s.cwd,
    activity: s.activity,
    claudeSessionId: s.claudeSessionId,
    pid: s.proc.pid,
    exited: s.exited,
    exitCode: s.exitCode,
    startedAt: s.startedAt,
  }))
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id)
}

/** Caminho com os symlinks resolvidos, como o subprocesso vai enxergar. */
function realPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Dimensao de terminal utilizavel, com o padrao quando vem lixo. */
function sane(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.min(Math.floor(value), 1000)
    : fallback
}

export function startSession(opts: SessionOptions): Session {
  const existing = sessions.get(opts.id)
  if (existing && !existing.exited) return existing

  const bin = resolveClaudeBin()
  // realpath antes de tudo: o proprio `claude` resolve o symlink ao nascer e
  // grava o transcript sob o caminho real. Guardando aqui o caminho nao
  // resolvido, a descoberta procurava em ~/.claude/projects/-tmp-projeto
  // enquanto o arquivo estava em -private-tmp-projeto, e o id da sessao
  // nunca era encontrado. Consequencia: a troca de conta caia para sessao
  // limpa e perdia o contexto sem dizer nada.
  const cwd = realPath(opts.cwd ? expandHome(opts.cwd) : DEFAULT_CWD)
  const args = opts.resume ? ['--continue'] : []

  // O token entra so como variavel de ambiente do subprocesso: quem fala com
  // a Anthropic e o binario oficial, nunca este servidor.
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color' }
  for (const key of INHERITED_MARKERS) delete env[key]
  if (opts.token) env.CLAUDE_CODE_OAUTH_TOKEN = opts.token
  else delete env.CLAUDE_CODE_OAUTH_TOKEN

  const proc = pty.spawn(bin, args, {
    // No Windows o node-pty usa ConPTY; useConpty fica no default do modulo.
    name: IS_WINDOWS ? 'xterm-color' : 'xterm-256color',
    // Mesma guarda que o resize aplica: dimensao zerada ou negativa chega
    // aqui quando o navegador conecta com a aba ainda escondida.
    cols: sane(opts.cols, 100),
    rows: sane(opts.rows, 30),
    cwd,
    env: env as { [key: string]: string },
  })

  const session: Session = {
    id: opts.id,
    cwd,
    activity: 'idle',
    claudeSessionId: null,
    proc,
    buffer: '',
    listeners: new Set(),
    exitListeners: new Set(),
    exited: false,
    exitCode: null,
    startedAt: Date.now(),
  }

  bind(session, proc)
  sessions.set(opts.id, session)
  return session
}

/**
 * Liga um processo aos listeners da sessao. Como os Sets vivem na sessao e
 * nao no processo, um restart troca o `claude` por baixo sem que o
 * WebSocket ja conectado perceba ou precise reconectar.
 */
function bind(session: Session, proc: pty.IPty): void {
  proc.onData((chunk) => {
    session.buffer += chunk
    if (session.buffer.length > REPLAY_LIMIT) {
      session.buffer = session.buffer.slice(-REPLAY_LIMIT)
    }
    for (const listener of session.listeners) listener(chunk)
  })

  proc.onExit(({ exitCode, signal }) => {
    // Um exit vindo de um processo ja substituido nao e o fim da sessao.
    if (session.proc !== proc) return
    session.exited = true
    session.exitCode = exitCode
    for (const listener of session.exitListeners) listener(exitCode, signal)
  })
}

/** Escreve uma linha da propria casca dentro do stream da sessao. */
export function emitNotice(session: Session, text: string): void {
  const line = `\r\n\x1b[38;2;224;108;117m::\x1b[0m ${text}\r\n`
  session.buffer += line
  for (const listener of session.listeners) listener(line)
}

export function setClaudeSessionId(id: string, claudeSessionId: string): void {
  const session = sessions.get(id)
  if (session) session.claudeSessionId = claudeSessionId
}

export function write(id: string, data: string): boolean {
  const session = sessions.get(id)
  if (!session || session.exited) return false
  session.proc.write(data)
  return true
}

export function resize(id: string, cols: number, rows: number): void {
  const session = sessions.get(id)
  if (!session || session.exited) return
  // O pty rejeita dimensoes zeradas, que acontecem quando a aba esta oculta.
  if (cols < 1 || rows < 1) return
  session.proc.resize(sane(cols, 100), sane(rows, 30))
}

export function killSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  if (!session.exited) session.proc.kill()
  sessions.delete(id)
}

/**
 * Encerra o processo atual e sobe outro no lugar, com `--continue` para o
 * transcript retomar de onde parou. E o coracao da troca de conta.
 *
 * A sessao e mutada no lugar, em vez de recriada, para que os listeners (e
 * portanto o WebSocket que o navegador ja tem aberto) continuem validos.
 */
export async function restartSession(
  id: string,
  opts: { token?: string; notice?: string },
): Promise<Session | null> {
  const session = sessions.get(id)
  if (!session) return null

  const cols = session.proc.cols
  const rows = session.proc.rows
  const previous = session.proc

  if (!session.exited) {
    await new Promise<void>((done) => {
      const timer = setTimeout(done, 3000)
      const sub = previous.onExit(() => {
        clearTimeout(timer)
        sub.dispose()
        done()
      })
      previous.kill()
    })
  }

  const bin = resolveClaudeBin()
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color' }
  for (const key of INHERITED_MARKERS) delete env[key]
  if (opts.token) env.CLAUDE_CODE_OAUTH_TOKEN = opts.token
  else delete env.CLAUDE_CODE_OAUTH_TOKEN

  // Retoma exatamente a conversa desta aba, nunca `--continue`: ele pega a
  // conversa mais recente do diretorio, que pode ser de outra aba ou de um
  // Claude Code aberto por fora, e a troca de conta sequestraria a sessao
  // errada. Sem id descoberto nao ha conversa nossa para retomar, entao
  // sobe limpo.
  const args = session.claudeSessionId ? ['--resume', session.claudeSessionId] : []

  const proc = pty.spawn(bin, args, {
    name: IS_WINDOWS ? 'xterm-color' : 'xterm-256color',
    cols,
    rows,
    cwd: session.cwd,
    env: env as { [key: string]: string },
  })

  session.proc = proc
  session.exited = false
  session.exitCode = null
  session.startedAt = Date.now()
  // O buffer antigo descreve um processo que nao existe mais.
  session.buffer = ''
  bind(session, proc)

  if (opts.notice) emitNotice(session, opts.notice)
  return session
}

/** Encerra tudo ao derrubar o servidor, para nao deixar `claude` orfao. */
export function killAll(): void {
  for (const id of [...sessions.keys()]) killSession(id)
}
