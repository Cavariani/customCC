import { useWorkspace } from '../../lib/workspace'
import { useNow } from '../../lib/useNow'
import { useCountUp } from '../../lib/useCountUp'
import { AccountTimeline } from '../AccountTimeline'
import {
  STATUS_LABEL,
  formatAgo,
  formatTokens,
  getStatus,
  ritmoDaJanela,
  windowRatio,
} from '../../lib/format'
import type { Account, Fatia } from '../../types'

const TOKEN_ISSUE: Record<string, string> = {
  missing: 'CLAUDE_TOKEN nao encontrado no arquivo',
  malformed: 'token com espaco ou quebra de linha, ou sem prefixo sk-ant-oat',
  truncated: 'token curto demais, provavelmente cortado ao colar',
}

// As animacoes ja tem interruptor global em [data-animations='false'], entao
// o bloco nao precisa carregar a preferencia ate cada linha.
export function AccountsView() {
  const { accounts, switching, switchAccount, periods } = useWorkspace()
  const now = useNow()

  if (accounts.length === 0) {
    return <div className="acct acct--empty">carregando contas...</div>
  }

  const total = accounts.reduce((t, a) => t + a.tokensUsed, 0)

  return (
    <div className="acct">
      <Total accounts={accounts} total={total} />

      <AccountTimeline periods={periods} now={now} />

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
            total={total}
            switching={switching}
            onSwitch={() => switchAccount(account.id)}
          />
        ))}
      </div>

      <Destino accounts={accounts} now={now} />
    </div>
  )
}

/**
 * O total das tres contas. Fica no corpo normal: o peso vem da posicao e
 * do contraste, nao de escala de poster.
 */
function Total({ accounts, total }: { accounts: Account[]; total: number }) {
  const soma = (pick: (a: Account) => number) => accounts.reduce((t, a) => t + pick(a), 0)
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

/** Par rotulo/valor. A grade de duas colunas e feita destes. */
function Par({ k, v }: { k: string; v: string }) {
  return (
    <div className="par">
      <span className="par__k">{k}</span>
      <b className="par__v">{v}</b>
    </div>
  )
}

interface RowProps {
  account: Account
  now: number
  total: number
  switching: boolean
  onSwitch: () => void
}

function Row({ account, now, total, switching, onSwitch }: RowProps) {
  const status = getStatus(account, now)
  const elapsed = windowRatio(account, now)
  const tokens = useCountUp(account.tokensUsed)
  const isActive = account.active
  const fatia = total === 0 ? 0 : (account.tokensUsed / total) * 100

  return (
    <div
      className={`arow arow--${status}${isActive ? ' is-on' : ''}${switching ? ' is-switching' : ''}`}
    >
      {/* Sem marca antes do numero: ela empurrava a linha 8px para a
          direita enquanto o lado direito ia ate a borda, entao o bloco
          inteiro ficava fora do centro. Quem esta em uso ja se identifica
          pela cor do numero e do nome. */}
      <div className="arow__1">
        <span className="arow__n">{String(account.id).padStart(2, '0')}</span>
        <span className="arow__name" title={account.email ?? undefined}>
          {account.label}
        </span>
        <span className="arow__state" title={account.limitEvidence ?? undefined}>
          {STATUS_LABEL[status]}
        </span>
        <span className="arow__v">{formatTokens(Math.round(tokens))}</span>
      </div>

      {/* Grade de pares em duas colunas. As colunas caem no mesmo lugar nas
          tres contas, entao a simetria vem da estrutura e nao de ajuste. */}
      <div className="arow__grade">
        <Par k="janela" v={`${Math.round(elapsed * 100)}%`} />
        <Par k="reinicia" v={account.resetAt === null ? '--:--' : clockOf(account.resetAt)} />
        <Par k="entrada" v={formatTokens(account.inputTokens)} />
        <Par k="saida" v={formatTokens(account.outputTokens)} />
        <Par k="cache" v={formatTokens(account.cacheTokens)} />
        <Par
          k="ultimo"
          v={account.lastUsedAt === null ? '--' : formatAgo(now - account.lastUsedAt)}
        />
        <Par k="sessoes" v={String(account.sessions)} />
        {/* A fatia no total e o dado que mais decide qual conta usar, e nao
            aparecia em lugar nenhum do painel antigo. */}
        <Par k="fatia" v={`${fatia.toFixed(1)}%`} />
      </div>

      {/* Medidor da janela ocupando a linha inteira. As celulas sao
          desenhadas em gradiente, e nao com o glifo repetido: com glifo o
          numero de celulas e fixo e a barra parava no meio da largura,
          deixando a metade direita vazia. */}
      <div className="arow__medidor" aria-hidden="true">
        <span
          className="arow__bar-fill"
          style={{ width: `${Math.min(100, Math.max(0, elapsed * 100))}%` }}
        />
      </div>

      {/* Altura fixa nas tres: a ativa mostra o estado no lugar exato onde
          as outras mostram o botao. Sem isso as linhas tinham alturas
          diferentes e a coluna inteira saia torta. */}
      <div className="arow__rod">
        {isActive ? (
          <span className="arow__emuso">em uso</span>
        ) : (
          <button
            type="button"
            className="arow__acao"
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
        )}
      </div>
    </div>
  )
}

/** Junta as fatias das tres contas numa lista so, ordenada. */
function junta(accounts: Account[], pick: (a: Account) => Fatia[]): Fatia[] {
  const mapa = new Map<string, number>()
  for (const conta of accounts) {
    for (const f of pick(conta)) mapa.set(f.nome, (mapa.get(f.nome) ?? 0) + f.tokens)
  }
  return [...mapa.entries()]
    .map(([nome, tokens]) => ({ nome, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
}

/**
 * Para onde foi e a que ritmo. O painel ja calculava as duas coisas e
 * nunca mostrou nenhuma; e o que ocupa o espaco que era do grafico.
 */
function Destino({ accounts, now }: { accounts: Account[]; now: number }) {
  const total = accounts.reduce((t, a) => t + a.tokensUsed, 0)
  const projetos = junta(accounts, (a) => a.porProjeto)
  const modelos = junta(accounts, (a) => a.porModelo)
  const ativa = accounts.find((a) => a.active)
  const ritmo = ativa ? ritmoDaJanela(ativa, now) : null

  const linha = (fatias: Fatia[]) =>
    fatias.length === 0
      ? '--'
      : fatias
          .slice(0, 2)
          .map((f) => `${f.nome} ${total === 0 ? 0 : Math.round((f.tokens / total) * 100)}%`)
          .join(' · ') + (fatias.length > 2 ? ` +${fatias.length - 2}` : '')

  return (
    <div className="destino">
      <h5 className="destino__t">destino e ritmo</h5>
      <div className="destino__kv">
        <span>projeto</span>
        <b>{linha(projetos)}</b>
        <span>modelo</span>
        <b>{linha(modelos)}</b>
        <span>ritmo · projecao</span>
        <b>
          {ritmo
            ? `${formatTokens(Math.round(ritmo.porHora))}/h → ${formatTokens(Math.round(ritmo.projetado))}`
            : '--'}
        </b>
      </div>
    </div>
  )
}
