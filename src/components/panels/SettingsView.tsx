import { FlaskConical } from 'lucide-react'
import { THEMES, type ThemeName } from '../../theme/themes'
import { useWorkspace } from '../../lib/workspace'

interface Props {
  theme: ThemeName
  onTheme: (name: ThemeName) => void
}

export function SettingsView({ theme, onTheme }: Props) {
  const { markRateLimited, accounts, activeAccountId, info } = useWorkspace()
  const activeLimited = accounts.find((a) => a.id === activeAccountId)?.rateLimited

  return (
    <div className="view">
      <section className="group">
        <h4 className="group__title">tema</h4>
        <div className="swatches">
          {(Object.keys(THEMES) as ThemeName[]).map((name) => {
            const c = THEMES[name]
            return (
              <button
                key={name}
                type="button"
                className={`swatch${theme === name ? ' is-active' : ''}`}
                onClick={() => onTheme(name)}
              >
                <span className="swatch__colors">
                  <span style={{ background: c.bg }} />
                  <span style={{ background: c.panel }} />
                  <span style={{ background: c.fg }} />
                  <span style={{ background: c.red }} />
                </span>
                {name}
              </button>
            )
          })}
        </div>
      </section>

      <section className="group">
        <h4 className="group__title">servidor</h4>
        {info ? (
          <ul className="kv">
            <li><span>claude</span><code>{info.claudeVersion}</code></li>
            <li><span>binario</span><code title={info.claudeBin}>{info.claudeBin}</code></li>
            <li><span>cwd padrao</span><code title={info.defaultCwd}>{info.defaultCwd}</code></li>
          </ul>
        ) : (
          <p className="view__note">servidor local nao respondeu.</p>
        )}
      </section>

      <section className="group">
        <h4 className="group__title">limite</h4>
        <button
          type="button"
          className="wide-btn wide-btn--ghost"
          onClick={markRateLimited}
          disabled={activeLimited}
        >
          <FlaskConical size={13} strokeWidth={2} />
          {activeLimited ? 'conta ativa ja marcada' : 'marcar conta ativa como no limite'}
        </button>
        <p className="view__note">
          Marca a conta ativa no estado do servidor. A deteccao automatica
          pelo output do pty ainda nao esta ligada.
        </p>
      </section>
    </div>
  )
}
