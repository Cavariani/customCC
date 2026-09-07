import { listProjectSessions, readTranscript } from './transcript.js'
import { registerTranscript } from './accounts.js'
import { setClaudeSessionId } from './pty.js'

/** Margem de folga: o transcript pode nascer antes do primeiro byte no pty. */
const SLACK_MS = 10_000
const FAST_POLL_MS = 2000
const SLOW_POLL_MS = 15_000
/** Depois disso a busca continua, so que devagar. */
const FAST_WINDOW_MS = 60_000

interface Watch {
  cwd: string
  startedAt: number
  /** Sessoes que ja existiam quando o processo subiu. */
  before: Set<string>
  timer: ReturnType<typeof setTimeout> | null
  resolved: boolean
}

const watches = new Map<string, Watch>()

/**
 * Descobre qual transcript o `claude` daquela aba abriu. O sessionId e
 * gerado pelo proprio binario, entao a unica forma de amarrar os dois e
 * observar o diretorio do projeto.
 *
 * Nao basta pegar o mais recente: se houver outro Claude Code rodando no
 * mesmo diretorio, o mais recente pode ser o dele, e tanto a quota quanto o
 * `--resume` mirariam a conversa errada. Por isso guardamos uma foto das
 * sessoes existentes antes de subir o processo e so aceitamos um id novo.
 *
 * A busca nao desiste: o transcript so nasce quando o primeiro prompt e
 * enviado, e isso pode levar horas.
 */
export async function startDiscovery(
  ptySessionId: string,
  cwd: string,
  startedAt: number,
): Promise<void> {
  stopDiscovery(ptySessionId)
  const before = new Set((await listProjectSessions(cwd)).map((s) => s.sessionId))
  const watch: Watch = { cwd, startedAt, before, timer: null, resolved: false }
  watches.set(ptySessionId, watch)
  schedule(ptySessionId, watch)
}

function schedule(ptySessionId: string, watch: Watch): void {
  const elapsed = Date.now() - watch.startedAt
  const delay = elapsed < FAST_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS
  watch.timer = setTimeout(async () => {
    if (watch.resolved) return
    const found = await attempt(ptySessionId, watch)
    if (!found && watches.get(ptySessionId) === watch) schedule(ptySessionId, watch)
  }, delay)
}

async function attempt(ptySessionId: string, watch: Watch): Promise<boolean> {
  try {
    for (const candidate of await listProjectSessions(watch.cwd)) {
      if (watch.before.has(candidate.sessionId)) continue
      if (candidate.mtime < watch.startedAt - SLACK_MS) continue
      const transcript = await readTranscript(candidate.file, candidate.sessionId)
      if (!transcript || transcript.updatedAt < watch.startedAt - SLACK_MS) continue
      await registerTranscript(candidate.sessionId, candidate.file, watch.cwd)
      setClaudeSessionId(ptySessionId, candidate.sessionId)
      watch.resolved = true
      stopDiscovery(ptySessionId)
      return true
    }
  } catch {
    /* tenta de novo no proximo tick */
  }
  return false
}

/**
 * Uma tentativa imediata, usada antes de uma troca de conta: sem isso, uma
 * aba cujo transcript acabou de nascer perderia o contexto na troca.
 */
export async function resolveNow(ptySessionId: string): Promise<boolean> {
  const watch = watches.get(ptySessionId)
  if (!watch || watch.resolved) return false
  return attempt(ptySessionId, watch)
}

export function stopDiscovery(ptySessionId: string): void {
  const watch = watches.get(ptySessionId)
  if (watch?.timer) clearTimeout(watch.timer)
  watches.delete(ptySessionId)
}
