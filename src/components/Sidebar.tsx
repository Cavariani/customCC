import { GitBranch, History, SlidersHorizontal, SquareStack, Users } from 'lucide-react'
import type { ViewName } from '../types'

interface RailItem {
  view: ViewName
  label: string
  Icon: typeof Users
  /** Cor propria da secao, no hover e quando aberta. */
  color: string
}

const ITEMS: RailItem[] = [
  // Contas em azul, e nao no vermelho do tema: vermelho num icone de
  // navegacao le como alerta, e este fica aceso o tempo todo.
  { view: 'accounts', label: 'contas', Icon: Users, color: 'var(--blue)' },
  { view: 'git', label: 'git', Icon: GitBranch, color: 'var(--green)' },
  { view: 'diff', label: 'mudancas', Icon: SquareStack, color: 'var(--warn)' },
  { view: 'history', label: 'historico', Icon: History, color: 'var(--violet)' },
  { view: 'settings', label: 'ajustes', Icon: SlidersHorizontal, color: 'var(--hl-keyword)' },
]

interface Props {
  view: ViewName
  onView: (view: ViewName) => void
  badges: Partial<Record<ViewName, string | number>>
}

export function Sidebar({ view, onView, badges }: Props) {
  return (
    <nav className="rail" aria-label="Secoes">
      {ITEMS.map(({ view: v, label, Icon, color }) => {
        const badge = badges[v]
        return (
          <button
            key={v}
            type="button"
            className={`rail__btn${view === v ? ' is-active' : ''}`}
            style={{ '--item': color } as React.CSSProperties}
            aria-label={label}
            aria-current={view === v || undefined}
            onClick={() => onView(v)}
          >
            <Icon size={17} strokeWidth={1.8} />
            {badge !== undefined && badge !== 0 && (
              <span className="rail__badge">
                {typeof badge === 'number' && badge > 99 ? '99+' : badge}
              </span>
            )}
            <span className="rail__tip">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
