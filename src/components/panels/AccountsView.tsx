import { AlertTriangle, Check, KeyRound, Loader2, Zap } from 'lucide-react'
import { useWorkspace } from '../../lib/workspace'
import { useNow } from '../../lib/useNow'
import {
  STATUS_LABEL,
  formatDuration,
  formatTokens,
  getStatus,
  maskEmail,
  msUntilReset,
  windowRatio,
} from '../../lib/format'
import type { Account } from '../../types'

const TOKEN_ISSUE: Record<string, string> = {
  missing: 'CLAUDE_TOKEN nao encontrado no arquivo',
  malformed: 'token com espaco ou quebra de linha, ou sem o prefixo sk-ant-oat',
  truncated: 'token curto demais, provavelmente cortado ao colar',
}

export function AccountsView() {
  const { accounts, switching, switchAccount } = useWorkspace()
  const now = useNow()

  if (accounts.length === 0) {
    return <div className="view"><p className="view__note">carregando contas...</p></div>
  }

  const comProblema = accounts.filter((a) => a.tokenIssue !== null)

  return (
    <div className="view">
      <div className="view__cards">
        {accounts.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            now={now}
            switching={switching}
            onSwitch={() => switchAccount(account.id)}
          />
        ))}
      </div>

      {comProblema.length > 0 && (
        <div className="group">
          {comProblema.map((a) => (
            <p key={a.id} className="view__note view__note--warn">
              <KeyRound size={12} strokeWidth={2} />
              conta {a.id}: {TOKEN_ISSUE[a.tokenIssue!]}
            </p>
          ))}
          <p className="view__note">
            Arquivo esperado em ~/.claude-multi-account/.env, com
            CLAUDE_TOKEN_1, _2 e _3, cada token numa linha so.
          </p>
        </div>
      )}

      <p className="view__note">
        Tokens contados a partir do usage real do transcript, atribuidos pela
        conta que estava ativa em cada mensagem. Nao ha percentual porque a
        Anthropic nao publica o teto da janela de 5h.
      </p>
    </div>
  )
}

interface CardProps {
  account: Account
  now: number
  switching: boolean
  onSwitch: () => void
}

function AccountCard({ account, now, switching, onSwitch }: CardProps) {
  const status = getStatus(account, now)
  const remaining = msUntilReset(account, now)
  const elapsed = windowRatio(account, now)

  return (
    <article className={`acct acct--${status}`}>
      <header className="acct__head">
        <span className="acct__n">{account.id}</span>
        <div className="acct__id">
          <h3 className="acct__label">{account.label}</h3>
          <p className="acct__email">
            {account.email ? maskEmail(account.email) : 'email nao informado'}
          </p>
        </div>
        <span className={`chip chip--${status}`}>
          {status === 'active' && <span className="chip__dot" />}
          {status === 'limited' && <AlertTriangle size={11} strokeWidth={2.2} />}
          {STATUS_LABEL[status]}
        </span>
      </header>

      <div className="acct__metrics">
        <div className="metric">
          <div className="metric__row">
            <span className="metric__label">
              tokens na janela · {account.sessions} {account.sessions === 1 ? 'sessao' : 'sessoes'}
            </span>
            <span className="metric__value">{formatTokens(account.tokensUsed)}</span>
          </div>
        </div>

        <div className="metric">
          <div className="metric__row">
            <span className="metric__label">reset em</span>
            <span className="metric__value">
              {remaining === null ? 'janela nao iniciada' : formatDuration(remaining)}
            </span>
          </div>
          <div
            className="bar bar--muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(elapsed * 100)}
            aria-label="janela de 5h decorrida"
          >
            <div className="bar__fill" style={{ width: `${Math.round(elapsed * 100)}%` }} />
          </div>
        </div>
      </div>

      <button
        type="button"
        className={`acct__action${account.active ? ' is-current' : ''}`}
        disabled={account.active || switching}
        onClick={onSwitch}
        title={
          account.tokenIssue === null
            ? undefined
            : `sem token valido: ${TOKEN_ISSUE[account.tokenIssue]}`
        }
      >
        {account.active ? (
          <>
            <Check size={13} strokeWidth={2.2} /> em uso
          </>
        ) : switching ? (
          <>
            <Loader2 size={13} strokeWidth={2.2} className="spin" /> trocando
          </>
        ) : (
          <>
            {account.hasToken ? (
              <Zap size={13} strokeWidth={2.2} />
            ) : (
              <KeyRound size={13} strokeWidth={2.2} />
            )}
            ativar conta {account.id}
          </>
        )}
      </button>
    </article>
  )
}
