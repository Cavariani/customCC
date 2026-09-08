import { useWorkspace } from '../../lib/workspace'
import { useNow } from '../../lib/useNow'
import { useCountUp } from '../../lib/useCountUp'
import { WindowBars } from '../WindowBars'
import {
  STATUS_LABEL,
  formatAgo,
  formatTokens,
  getStatus,
  windowRatio,
} from '../../lib/format'
import type { Account } from '../../types'

const TOKEN_ISSUE: Record<string, string> = {
  missing: 'CLAUDE_TOKEN nao encontrado no arquivo',
  malformed: 'token com espaco ou quebra de linha, ou sem prefixo sk-ant-oat',
  truncated: 'token curto demais, provavelmente cortado ao colar',
}

/** Celulas do medidor em bloco. */
const CELULAS = 24

// As animacoes ja tem interruptor global em [data-animations='false'], entao
// o bloco nao precisa carregar a preferencia ate cada linha.
export function AccountsView() {
  const { accounts, switching, switchAccount } = useWorkspace()
  const now = useNow()

  if (accounts.length === 0) {
    return <div className="acct acct--empty">carregando contas...</div>
  }

  return (
    <div className="acct">
      <Total accounts={accounts} />

      {/* Regua de titulos, como a linha de cabecalho do `top`. */}
      <div className="acct__cols">
        <span className="acct__c-n">#</span>
        <span className="acct__c-name">conta</span>
        <span className="acct__c-v">tokens</span>
      </div>

      <div className="acct__rows">
        {accounts.map((account) => (
          <Row
            key={account.id}
            account={account}
            now={now}
            switching={switching}
            onSwitch={() => switchAccount(account.id)}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * O total das tres contas, que e o numero que resume o painel. Fica no
 * corpo normal: o peso vem da posicao e do contraste, nao de escala.
 */
function Total({ accounts }: { accounts: Account[] }) {
  const soma = (pick: (a: Account) => number) => accounts.reduce((t, a) => t + pick(a), 0)
  const total = soma((a) => a.tokensUsed)
  const cache = soma((a) => a.cacheTokens)
  const animado = useCountUp(total)

  return (
    <div className="acct__total">
      <div className="acct__total-line">
        <span className="acct__total-v">{formatTokens(Math.round(animado))}</span>
        <span className="acct__total-k">
          tokens {accounts.length === 3 ? 'nas tres contas' : `em ${accounts.length} contas`}
        </span>
      </div>
      <div className="acct__split">
        <span>
          entrada <b>{formatTokens(soma((a) => a.inputTokens))}</b>
        </span>
        <span>
          saida <b>{formatTokens(soma((a) => a.outputTokens))}</b>
        </span>
        {/* O cache e ~98% do total na pratica: mostrar a fatia evita ler o
            numero de cima como se fosse consumo novo. */}
        <span>
          cache <b>{total === 0 ? '--' : `${Math.round((cache / total) * 100)}%`}</b>
        </span>
      </div>
    </div>
  )
}

/** Horario local no formato 24h, que e como o Pedro le a hora. */
function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

interface RowProps {
  account: Account
  now: number
  switching: boolean
  onSwitch: () => void
}

function Row({ account, now, switching, onSwitch }: RowProps) {
  const status = getStatus(account, now)
  const elapsed = windowRatio(account, now)
  const tokens = useCountUp(account.tokensUsed)
  const isActive = account.active

  // Uma cor por estado: o ativo e o destaque, os outros recuam para cinza
  // em vez de disputarem atencao.
  const accent =
    status === 'limited' ? 'var(--color-error)' : isActive ? 'var(--red)' : 'var(--color-muted)'

  const cheias = Math.round(Math.min(1, Math.max(0, elapsed)) * CELULAS)

  return (
    <div
      className={`arow arow--${status}${isActive ? ' is-on' : ''}${switching ? ' is-switching' : ''}`}
    >
      {/* Linha 1: marca, indice, nome, estado e o total da janela. */}
      <div className="arow__1">
        <span className="arow__mark" aria-hidden="true">
          ▌
        </span>
        <span className="arow__n">{String(account.id).padStart(2, '0')}</span>
        <span className="arow__name" title={account.email ?? undefined}>
          {account.label}
        </span>
        <span className="arow__state" title={account.limitEvidence ?? undefined}>
          {STATUS_LABEL[status]}
        </span>
        <span className="arow__v">{formatTokens(Math.round(tokens))}</span>
      </div>

      {/* Linha 2: o medidor em bloco, sozinho na linha. Mesmo glifo em duas
          cores, entao as celulas alinham por construcao. */}
      <div className="arow__2">
        <span className="arow__bar" aria-hidden="true">
          <span className="arow__bar-fill">{'█'.repeat(cheias)}</span>
          <span className="arow__bar-rest">{'█'.repeat(CELULAS - cheias)}</span>
        </span>
        <span className="arow__pct">{Math.round(elapsed * 100)}%</span>
        <span className="arow__reset">
          {account.resetSource === 'observed' && <em title="reset lido do terminal">◎</em>}
          {account.resetAt === null ? '↺ --:--' : `↺ ${clockOf(account.resetAt)}`}
        </span>
      </div>

      {/* Linha 3: o consumo por fatia da janela. Barras, e nao curva: o
          gasto real vem em rajada, entao a curva suave virava um fio reto
          com um pico numa das pontas. Cada fatia tem trilho proprio, entao
          a janela zerada ainda le como escala graduada em vez de vao. E
          ela que absorve a folga de altura do painel. */}
      <div className="arow__graph">
        <WindowBars series={account.series} progress={elapsed} accent={accent} />
      </div>

      {/* Linha 4: a reparticao dos tokens, em colunas alinhadas. */}
      <div className="arow__split">
        <span>entrada</span>
        <b>{formatTokens(account.inputTokens)}</b>
        <span className="arow__sp">·</span>
        <span>cache</span>
        <b className="arow__l">{formatTokens(account.cacheTokens)}</b>

        <span>saida</span>
        <b>{formatTokens(account.outputTokens)}</b>
        <span className="arow__sp">·</span>
        <span>ultimo</span>
        <b className="arow__l">
          {account.lastUsedAt === null ? '--' : formatAgo(now - account.lastUsedAt)}
        </b>
      </div>

      {!isActive && (
        <div className="arow__do">
          <button
            type="button"
            disabled={switching}
            onClick={onSwitch}
            title={
              account.tokenIssue === null
                ? undefined
                : `sem token valido: ${TOKEN_ISSUE[account.tokenIssue]}`
            }
          >
            {account.tokenIssue === null ? 'ativar' : 'ativar (sem token)'}
          </button>
        </div>
      )}
    </div>
  )
}
