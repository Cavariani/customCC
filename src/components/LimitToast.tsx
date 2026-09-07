import { AlertTriangle, ArrowRight } from 'lucide-react'
import { useWorkspace } from '../lib/workspace'
import { useNow } from '../lib/useNow'
import { msUntilReset } from '../lib/format'

/**
 * Aparece quando a conta ativa acusa limite. A deteccao e automatica na
 * Fase 2 (lendo o output do pty), mas a troca continua sendo um clique.
 */
export function LimitToast() {
  const { accounts, activeAccountId, switchAccount, switching } = useWorkspace()
  const now = useNow(5000)
  const active = accounts.find((a) => a.id === activeAccountId)
  if (!active?.rateLimited) return null

  const candidate = accounts
    .filter((a) => a.id !== activeAccountId && !a.rateLimited)
    .sort((a, b) => {
      const ra = msUntilReset(a, now)
      const rb = msUntilReset(b, now)
      if (ra === null) return -1
      if (rb === null) return 1
      return rb - ra
    })[0]

  return (
    <div className="toast" role="alert">
      <AlertTriangle size={15} strokeWidth={2.1} style={{ color: 'var(--color-error)' }} />
      <div className="toast__body">
        <strong className="toast__title">limite atingido na conta {active.id}</strong>
        <span className="toast__sub">
          {candidate
            ? `conta ${candidate.id} (${candidate.label}) esta disponivel`
            : 'nenhuma outra conta disponivel agora'}
        </span>
      </div>
      {candidate && (
        <button
          type="button"
          className="toast__action"
          disabled={switching}
          onClick={() => switchAccount(candidate.id)}
        >
          trocar <ArrowRight size={12} strokeWidth={2.4} />
        </button>
      )}
    </div>
  )
}
