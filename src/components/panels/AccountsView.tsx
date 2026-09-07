import { AlertTriangle, KeyRound, Radio, Zap } from 'lucide-react'
import { useWorkspace } from '../../lib/workspace'
import { useNow } from '../../lib/useNow'
import { useCountUp } from '../../lib/useCountUp'
import { useScramble } from '../../lib/useScramble'
import { ScopeTrace } from '../ScopeTrace'
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

/**
 * Numero pequeno com rotulo. A cor e fixa por tipo de dado, entao o olho
 * aprende que roxo e sempre pico e verde e sempre recencia.
 */
function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`stat-cell stat-cell--${tone}`}>
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
  const label = useScramble(account.label, {
    enabled: animations,
    trigger: isActive,
    skipFirst: true,
  })

  // Uma serie por card: a cor carrega estado, nao identidade. O ativo e o
  // destaque; os outros recuam para cinza em vez de disputarem atencao.
  const accent =
    status === 'limited' ? 'var(--color-error)' : isActive ? 'var(--red)' : 'var(--color-muted)'

  return (
    <article
      className={`bay bay--${status}${switching ? ' is-switching' : ''}`}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <span className="bay__grid" aria-hidden="true" />
      <span className="bay__bracket bay__bracket--tl" aria-hidden="true" />
      <span className="bay__bracket bay__bracket--br" aria-hidden="true" />

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

      <div className="scope">
        <div className="scope__readout">
          <span className="scope__big">{formatTokens(Math.round(tokens))}</span>
          <span className="scope__small">tokens na janela</span>
        </div>
        <ScopeTrace
          series={account.series}
          progress={elapsed}
          accent={accent}
          live={isActive && animations}
        />
      </div>

      <footer className="bay__foot">
        <Stat label="sessoes" value={String(account.sessions)} tone="blue" />
        <Stat
          label="pico 10m"
          value={account.peakTokens > 0 ? formatTokens(account.peakTokens) : '--'}
          tone="violet"
        />
        <Stat
          label="ultimo"
          value={account.lastUsedAt === null ? '--' : formatAgo(now - account.lastUsedAt)}
          tone="green"
        />

        <div className="bay__reset">
          <span className="bay__clock">
            {account.resetAt === null ? '--:--' : clockOf(account.resetAt)}
          </span>
          <span className="bay__rel">
            {account.resetSource === 'observed' && (
              <Radio size={9} strokeWidth={2.6} style={{ color: 'var(--green)' }} />
            )}
            {remaining === null ? 'nao iniciada' : `em ${formatDuration(remaining)}`}
          </span>
        </div>

        {!isActive && (
          <button
            type="button"
            className="bay__action"
            disabled={switching}
            onClick={onSwitch}
            title={
              account.tokenIssue === null
                ? undefined
                : `sem token valido: ${TOKEN_ISSUE[account.tokenIssue]}`
            }
          >
            {account.tokenIssue === null ? (
              <Zap size={11} strokeWidth={2.4} />
            ) : (
              <KeyRound size={11} strokeWidth={2.4} />
            )}
            ativar
          </button>
        )}
      </footer>
    </article>
  )
}
