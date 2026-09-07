import { AlertTriangle, KeyRound, Radio, Zap } from 'lucide-react'
import { useWorkspace } from '../../lib/workspace'
import { useNow } from '../../lib/useNow'
import { useCountUp } from '../../lib/useCountUp'
import { useScramble } from '../../lib/useScramble'
import { WindowBars } from '../WindowBars'
import {
  STATUS_LABEL,
  formatAgo,
  formatDuration,
  formatTokens,
  getStatus,
  msUntilReset,
  windowRatio,
} from '../../lib/format'
import type { Account } from '../../types'

const TOKEN_ISSUE: Record<string, string> = {
  missing: 'CLAUDE_TOKEN nao encontrado no arquivo',
  malformed: 'token com espaco ou quebra de linha, ou sem prefixo sk-ant-oat',
  truncated: 'token curto demais, provavelmente cortado ao colar',
}

export function AccountsView({ animations }: { animations: boolean }) {
  const { accounts, switching, switchAccount } = useWorkspace()
  const now = useNow()

  if (accounts.length === 0) {
    return <div className="bays bays--empty">carregando contas...</div>
  }

  return (
    <div className="bays">
      {accounts.map((account, i) => (
        <AccountBay
          key={account.id}
          account={account}
          now={now}
          index={i}
          switching={switching}
          animations={animations}
          onSwitch={() => switchAccount(account.id)}
        />
      ))}
    </div>
  )
}

/** Horario local no formato 24h, que e como o Pedro le a hora. */
function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** Numero pequeno com rotulo, alinhados em coluna para varrer com o olho. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-cell">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

interface BayProps {
  account: Account
  now: number
  index: number
  switching: boolean
  animations: boolean
  onSwitch: () => void
}

function AccountBay({ account, now, index, switching, animations, onSwitch }: BayProps) {
  const status = getStatus(account, now)
  const remaining = msUntilReset(account, now)
  const elapsed = windowRatio(account, now)
  const tokens = useCountUp(account.tokensUsed)
  const isActive = account.active
  // O nome se remonta a cada troca: o card mostra que acabou de assumir.
  const label = useScramble(account.label, { enabled: animations, trigger: isActive })

  // Uma serie por card: a cor carrega estado, nao identidade. O ativo e o
  // destaque; os outros recuam para cinza em vez de disputarem atencao.
  const accent =
    status === 'limited' ? 'var(--color-error)' : isActive ? 'var(--red)' : 'var(--color-muted)'

  return (
    <article
      className={`bay bay--${status}${switching ? ' is-switching' : ''}`}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <span className="bay__bracket bay__bracket--tl" aria-hidden="true" />
      <span className="bay__bracket bay__bracket--br" aria-hidden="true" />
      {isActive && <span className="bay__sweep" aria-hidden="true" />}

      <header className="bay__head">
        <span className="bay__n">{String(account.id).padStart(2, '0')}</span>

        <div className="bay__id">
          <h3 className="bay__label">{label}</h3>
          <p className="bay__email" title={account.email ?? undefined}>
            {account.email ?? 'email nao informado'}
          </p>
        </div>

        <span className={`led led--${status}`} title={account.limitEvidence ?? undefined}>
          <span className="led__dot" />
          {status === 'limited' && <AlertTriangle size={10} strokeWidth={2.4} />}
          {STATUS_LABEL[status]}
        </span>
      </header>

      <div className="bay__readout">
        <div className="readout">
          <span className="readout__value">{formatTokens(Math.round(tokens))}</span>
          <span className="readout__unit">tokens na janela</span>
        </div>

        <div className="reset">
          <span className="reset__clock">
            {account.resetAt === null ? '--:--' : clockOf(account.resetAt)}
          </span>
          <span className="reset__rel">
            {remaining === null ? 'janela nao iniciada' : `reset em ${formatDuration(remaining)}`}
          </span>
        </div>
      </div>

      <WindowBars series={account.series} progress={elapsed} accent={accent} />

      <div className="axis" aria-hidden="true">
        <span>inicio</span>
        <span className="axis__rule" />
        <span>{account.resetAt === null ? '+5h' : clockOf(account.resetAt)}</span>
      </div>

      <dl className="stats">
        <Stat label="sessoes" value={String(account.sessions)} />
        <Stat
          label="pico / 10min"
          value={account.peakTokens > 0 ? formatTokens(account.peakTokens) : '--'}
        />
        <Stat
          label="ultimo uso"
          value={account.lastUsedAt === null ? '--' : formatAgo(now - account.lastUsedAt)}
        />
      </dl>

      <footer className="bay__foot">
        {account.resetSource === 'observed' ? (
          <span className="bay__reset bay__reset--real">
            <Radio size={10} strokeWidth={2.4} /> reset lido do terminal
          </span>
        ) : (
          <span className="bay__reset">reset estimado</span>
        )}

        {account.tokenIssue !== null && (
          <span className="bay__warn" title={TOKEN_ISSUE[account.tokenIssue]}>
            <KeyRound size={10} strokeWidth={2.4} /> sem token
          </span>
        )}

        {!isActive && (
          <button
            type="button"
            className="bay__action"
            disabled={switching}
            onClick={onSwitch}
          >
            <Zap size={11} strokeWidth={2.4} />
            ativar
          </button>
        )}
      </footer>
    </article>
  )
}
