import { FlaskConical } from 'lucide-react'
import { pedirPermissaoDeAviso } from '../../lib/useNotifier'
import { THEMES, type ThemeName } from '../../theme/themes'
import { useWorkspace } from '../../lib/workspace'
import type { Prefs } from '../../lib/usePrefs'

interface Props {
  theme: ThemeName
  onTheme: (name: ThemeName) => void
  prefs: Prefs
  onPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void
}

export function SettingsView({ theme, onTheme, prefs, onPref }: Props) {
  const { markRateLimited, accounts, activeAccountId, info, autoSwitch, setAutoSwitch } =
    useWorkspace()
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
        <h4 className="group__title">interface</h4>

        <Choice
          label="densidade"
          value={prefs.density}
          options={['compacta', 'confortavel']}
          onPick={(v) => onPref('density', v as Prefs['density'])}
        />

        <Toggle
          label="animacoes"
          hint="pulsos, varreduras e transicoes"
          on={prefs.animations}
          onToggle={() => onPref('animations', !prefs.animations)}
        />

        <Toggle
          label="avisos do sistema"
          hint="quando uma aba termina ou pede permissao"
          on={prefs.notify}
          onToggle={async () => {
            if (prefs.notify) return onPref('notify', false)
            // A permissao do navegador so pode ser pedida a partir de um clique.
            const resposta = await pedirPermissaoDeAviso()
            onPref('notify', resposta === 'granted')
          }}
        />

        <Toggle
          label="grao no fundo"
          hint="textura fina sobre o preto"
          on={prefs.grain}
          onToggle={() => onPref('grain', !prefs.grain)}
        />

        <div className="field">
          <span className="field__label">
            corpo do terminal <em>{prefs.terminalFontSize}px</em>
          </span>
          <input
            type="range"
            min={10}
            max={18}
            step={0.5}
            value={prefs.terminalFontSize}
            onChange={(e) => onPref('terminalFontSize', Number(e.target.value))}
          />
        </div>

        <div className="field">
          <span className="field__label">
            entrelinha do terminal <em>{prefs.terminalLineHeight}</em>
          </span>
          <input
            type="range"
            min={1}
            max={1.6}
            step={0.05}
            value={prefs.terminalLineHeight}
            onChange={(e) => onPref('terminalLineHeight', Number(e.target.value))}
          />
        </div>

        <p className="view__note">painel recolhe e volta com cmd+B</p>
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

        <Toggle
          label="troca automatica de conta"
          hint="ao bater o limite, assume a proxima conta disponivel e retoma a conversa"
          on={autoSwitch}
          onToggle={() => setAutoSwitch(!autoSwitch)}
        />

        <p className="view__note">
          esta preferencia fica no servidor, nao no navegador: a troca acontece la e vale
          mesmo com nenhuma aba aberta.
        </p>

        <button
          type="button"
          className="wide-btn wide-btn--ghost"
          onClick={markRateLimited}
          disabled={activeLimited}
        >
          <FlaskConical size={13} strokeWidth={2} />
          {activeLimited ? 'conta ativa ja marcada' : 'marcar conta ativa como no limite'}
        </button>
      </section>
    </div>
  )
}

function Toggle({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string
  hint: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`switch${on ? ' is-on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={onToggle}
    >
      <span className="switch__text">
        {label}
        <em>{hint}</em>
      </span>
      <span className="switch__track"><span className="switch__knob" /></span>
    </button>
  )
}

function Choice({
  label,
  value,
  options,
  onPick,
}: {
  label: string
  value: string
  options: string[]
  onPick: (value: string) => void
}) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <div className="segmented">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={option === value ? 'is-on' : undefined}
            onClick={() => onPick(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}
