import { GitBranch, SlidersHorizontal, SquareStack, Users } from 'lucide-react'
import type { ViewName } from '../types'

interface RailItem {
  view: ViewName
  label: string
  Icon: typeof Users
}

const ITEMS: RailItem[] = [
  // Sem cor por secao: quatro icones em quatro cores era um codigo de
  // identidade, e neste painel a cor carrega estado. Quem esta aberto usa
  // o acento do tema; o resto fica neutro.
  { view: 'accounts', label: 'contas', Icon: Users },
  { view: 'git', label: 'git', Icon: GitBranch },
  { view: 'diff', label: 'mudancas', Icon: SquareStack },
  { view: 'settings', label: 'ajustes', Icon: SlidersHorizontal },
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
      {ITEMS.map(({ view: v, label, Icon }) => {
        const badge = badges[v]
        const isAlert = v === 'accounts' && alert
        return (
          <button
            key={v}
            type="button"
            className={`rail__btn${view === v ? ' is-active' : ''}${isAlert ? ' is-alert' : ''}`}
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
