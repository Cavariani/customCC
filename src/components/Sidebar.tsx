import { GitBranch, SlidersHorizontal, SquareStack, Users } from 'lucide-react'
import type { ViewName } from '../types'

interface RailItem {
  view: ViewName
  label: string
  Icon: typeof Users
  /** Cor propria de cada dominio: contas, git, diff, config. */
  color: string
}

const ITEMS: RailItem[] = [
  { view: 'accounts', label: 'contas', Icon: Users, color: 'var(--red)' },
  { view: 'git', label: 'git', Icon: GitBranch, color: 'var(--green)' },
  { view: 'diff', label: 'mudancas', Icon: SquareStack, color: 'var(--warn)' },
  { view: 'settings', label: 'ajustes', Icon: SlidersHorizontal, color: 'var(--hl-keyword)' },
]

interface Props {
  view: ViewName
  onView: (view: ViewName) => void
  badges: Partial<Record<ViewName, string | number>>
  alert: boolean
}

export function Sidebar({ view, onView, badges, alert }: Props) {
  return (
    <nav className="rail" aria-label="Secoes">
      <div className="rail__mark" title="Claude Code Multi-Conta" aria-hidden="true">
        cc
      </div>
      {ITEMS.map(({ view: v, label, Icon, color }) => {
        const badge = badges[v]
        const isAlert = v === 'accounts' && alert
        return (
          <button
            key={v}
            type="button"
            className={`rail__btn${view === v ? ' is-active' : ''}${isAlert ? ' is-alert' : ''}`}
            style={{ '--item': color } as React.CSSProperties}
            aria-label={label}
            aria-current={view === v || undefined}
            onClick={() => onView(v)}
          >
            <Icon size={17} strokeWidth={1.8} />
            {badge !== undefined && badge !== 0 && (
              <span className="rail__badge">{badge}</span>
            )}
            <span className="rail__tip">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
