import { Cpu, GitBranch, TerminalSquare } from 'lucide-react'
import { useWorkspace } from '../lib/workspace'
import { useNow } from '../lib/useNow'
import { formatDuration, formatTokens, msUntilReset } from '../lib/format'

export function StatusBar() {
  const { accounts, activeAccountId, git, changes, tabs, info } = useWorkspace()
  const now = useNow()
  const active = accounts.find((a) => a.id === activeAccountId)
  const remaining = active ? msUntilReset(active, now) : null

  return (
    <footer className="status">
      {git?.repo && (
        <span className="status__item">
          <GitBranch size={11} strokeWidth={2} style={{ color: 'var(--green)' }} />
          {git.branch}
        </span>
      )}
      {changes && changes.files.length > 0 && (
        <span className="status__item">
          <span className="stat stat--add">+{changes.totals.added}</span>
          <span className="stat stat--del">-{changes.totals.removed}</span>
        </span>
      )}
      <span className="status__item status__item--muted">
        <TerminalSquare size={11} strokeWidth={2} />
        {tabs.length}
      </span>

      <span className="status__spacer" />

      {info && (
        <span className="status__item status__item--muted" title={info.claudeBin}>
          claude {info.claudeVersion.split(' ')[0]}
        </span>
      )}
      {active && (
        <>
          <span className="status__item">
            <Cpu size={11} strokeWidth={2} style={{ color: 'var(--red)' }} />
            conta {active.id} · {active.label}
          </span>
          <span className="status__item">{formatTokens(active.tokensUsed)} tokens</span>
          <span className="status__item status__item--muted">
            reset {remaining === null ? 'nao iniciado' : formatDuration(remaining)}
          </span>
        </>
      )}
    </footer>
  )
}
