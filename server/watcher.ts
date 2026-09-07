import { detectLimit, type LimitSignal } from './limits.js'
import {
  clearRateLimited,
  getActiveAccountId,
  markRateLimited,
  noteResetHint,
} from './accounts.js'
import type { Session } from './pty.js'

/**
 * Tamanho da cauda mantida entre chunks. A TUI escreve em pedacos, e a frase
 * pode nascer partida no meio de dois deles.
 */
const TAIL = 4096
/** Nao remarca o mesmo estado em rajada enquanto a TUI redesenha a tela. */
const DEBOUNCE_MS = 15_000

interface WatchState {
  tail: string
  lastKind: LimitSignal['kind'] | null
  lastAt: number
}

const states = new WeakMap<Session, WatchState>()

export type LimitEvent = { session: Session; signal: LimitSignal; accountId: number }
type Handler = (event: LimitEvent) => void

const handlers = new Set<Handler>()

export function onLimitEvent(handler: Handler): void {
  handlers.add(handler)
}

/**
 * Observa o output de uma sessao procurando os avisos de limite. O listener
 * e adicionado ao Set da sessao, entao sobrevive ao restart do processo
 * numa troca de conta.
 */
export function watchSession(session: Session): void {
  if (states.has(session)) return
  states.set(session, { tail: '', lastKind: null, lastAt: 0 })

  session.listeners.add((chunk: string) => {
    const state = states.get(session)
    if (!state) return

    const text = state.tail + chunk
    state.tail = text.slice(-TAIL)

    const signal = detectLimit(text)
    if (!signal) return

    const now = Date.now()
    // O mesmo aviso repintado na tela nao e um evento novo.
    if (signal.kind === state.lastKind && now - state.lastAt < DEBOUNCE_MS) return
    state.lastKind = signal.kind
    state.lastAt = now

    void apply(session, signal)
  })
}

async function apply(session: Session, signal: LimitSignal): Promise<void> {
  const accountId = await getActiveAccountId()

  if (signal.kind === 'reached' || signal.kind === 'credits') {
    await markRateLimited(accountId, { resetAt: signal.resetAt, evidence: signal.evidence })
  } else if (signal.kind === 'cleared') {
    await clearRateLimited(accountId)
  } else if (signal.kind === 'hint' && signal.resetAt !== null) {
    await noteResetHint(accountId, signal.resetAt)
  }

  for (const handler of handlers) handler({ session, signal, accountId })
}
