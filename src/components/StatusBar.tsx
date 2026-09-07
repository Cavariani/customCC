import { Cpu, GitBranch, TerminalSquare } from 'lucide-react'
import { useWorkspace } from '../lib/workspace'
import { useNow } from '../lib/useNow'
import { formatDuration, formatTokens, msUntilReset, windowRatio } from '../lib/format'
import { WindowBars } from './WindowBars'
import { Delta } from './Delta'
import { useScramble } from '../lib/useScramble'

export function StatusBar({ animations }: { animations: boolean }) {
  const { accounts, activeAccountId, git, changes, tabs, info } = useWorkspace()
  const now = useNow()
  const active = accounts.find((a) => a.id === activeAccountId)
  const remaining = active ? msUntilReset(active, now) : null
  const label = useScramble(active ? `conta ${active.id} · ${active.label}` : '', {
    enabled: animations,
    skipFirst: true,
  })

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
          <Delta added={changes.totals.added} removed={changes.totals.removed} />
        </span>
      )}
      <span className="status__item status__item--muted">
        <TerminalSquare size={11} strokeWidth={2} />
        {tabs.length}
      </span>

      <span className="status__spacer" />

      <span className="status__item status__item--muted status__kbd">cmd+K</span>

      {info && (
        <span className="status__item status__item--muted" title={info.claudeBin}>
          claude {info.claudeVersion.split(' ')[0]}
        </span>
      )}
      {active && (
        <>
          <span className="status__item">
            <Cpu size={11} strokeWidth={2} style={{ color: 'var(--red)' }} />
            {label}
          </span>
          <span className="status__item status__spark">
            <WindowBars
              series={active.series}
              progress={windowRatio(active, now)}
              accent="var(--red)"
              height={11}
            />
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
