import { AlertTriangle, ArrowRight, X } from 'lucide-react'
import { useWorkspace } from '../lib/workspace'
import { useNow } from '../lib/useNow'
import { formatDuration, msUntilReset } from '../lib/format'

/**
 * Aparece quando a conta ativa acusa limite. A deteccao e automatica, lendo
 * o output do pty, mas a troca continua sendo um clique: o alerta sugere, o
 * Pedro decide.
 */
export function LimitToast() {
  const { accounts, activeAccountId, switchAccount, clearLimit, switching } = useWorkspace()
  const now = useNow(1000)
  const active = accounts.find((a) => a.id === activeAccountId)
  if (!active?.rateLimited) return null

  const remaining = msUntilReset(active, now)

  const candidate = accounts
    .filter((a) => a.id !== activeAccountId && !a.rateLimited && a.hasToken)
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
        <strong className="toast__title">
          limite atingido na conta {active.id} ({active.label})
        </strong>
        <span className="toast__sub">
          {candidate
            ? `conta ${candidate.id} (${candidate.label}) disponivel`
            : 'nenhuma outra conta com token disponivel'}
          {remaining !== null && ` · reset em ${formatDuration(remaining)}`}
        </span>
        {active.limitEvidence && (
          <span className="toast__evidence" title={active.limitEvidence}>
            {active.limitEvidence}
          </span>
        )}
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

      <button
        type="button"
        className="toast__dismiss"
        aria-label="Descartar alerta"
        title="descartar (falso positivo)"
        onClick={() => clearLimit(active.id)}
      >
        <X size={13} strokeWidth={2.2} />
      </button>
    </div>
  )
}
