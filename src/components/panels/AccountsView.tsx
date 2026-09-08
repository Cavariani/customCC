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

  // Duas contas diferentes, e o painel precisa das duas:
  //  - trabalho = entrada + saida, o que de fato foi escrito e lido de novo;
  //  - quota    = trabalho + cache, que e o que consome a janela de 5h.
  // Medido nesta maquina, o cache e ~99,7% da quota, entao o numero unico de
  // antes era, na pratica, "cache relido" — nao o trabalho.
  const trabalho = accounts.reduce((t, a) => t + a.inputTokens + a.outputTokens, 0)

  return (
    <div className="acct">
      <Total accounts={accounts} trabalho={trabalho} />

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
            trabalho={trabalho}
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
function Total({ accounts, trabalho }: { accounts: Account[]; trabalho: number }) {
  const soma = (pick: (a: Account) => number) => accounts.reduce((t, a) => t + pick(a), 0)
  const animado = useCountUp(trabalho)
  const onde = accounts.length === 3 ? 'nas tres contas' : `em ${accounts.length} contas`

  return (
    <div className="acct__total">
      <div className="acct__total-line">
        <span className="acct__total-v">{formatTokens(Math.round(animado))}</span>
        <span className="acct__total-k">entrada e saida {onde}</span>
      </div>
      <div className="acct__split">
        <span>
          entrada <b>{formatTokens(soma((a) => a.inputTokens))}</b>
        </span>
        <span>
          saida <b>{formatTokens(soma((a) => a.outputTokens))}</b>
        </span>
        {/* O cache fica ao lado, e nao no numero grande: ele domina a soma
            sem ser trabalho novo. Mas continua a vista porque e ele que
            enche a janela. */}
        <span title="cache relido; conta para o limite, mas nao e trabalho novo">
          cache <b>{formatTokens(soma((a) => a.cacheTokens))}</b>
        </span>
      </div>
    </div>
  )
}

/** Horario local no formato 24h, que e como o Pedro le a hora. */
function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** Barra rotulada, com o valor a direita. As duas de uma conta alinham. */
function Medidor({
  k,
  pct,
  valor,
  titulo,
}: {
  k: string
  pct: number
  valor: string
  titulo: string
}) {
  return (
    <div className="med" title={titulo}>
      <span className="med__k">{k}</span>
      <span className="med__trilho">
        <span className="med__fill" style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }} />
      </span>
      <b className="med__v">{valor}</b>
    </div>
  )
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
  /** Entrada + saida somada das tres contas, base da fatia. */
  trabalho: number
  switching: boolean
  onSwitch: () => void
}

function Row({ account, now, trabalho, switching, onSwitch }: RowProps) {
  const status = getStatus(account, now)
  const elapsed = windowRatio(account, now)
  const isActive = account.active
  // A conta mostra o mesmo que o numero grande: entrada + saida. O cache
  // fica na grade, para a quota continuar derivavel sem dominar a leitura.
  const meuTrabalho = account.inputTokens + account.outputTokens
  const tokens = useCountUp(meuTrabalho)
  const fatia = trabalho === 0 ? 0 : (meuTrabalho / trabalho) * 100
  const estimado = account.resetSource !== 'observed'

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
        <Par k="reinicia" v={account.resetAt === null ? '--:--' : clockOf(account.resetAt)} />
        <Par
          k="ultimo"
          v={account.lastUsedAt === null ? '--' : formatAgo(now - account.lastUsedAt)}
        />
        <Par k="entrada" v={formatTokens(account.inputTokens)} />
        <Par k="saida" v={formatTokens(account.outputTokens)} />
        <Par k="cache" v={formatTokens(account.cacheTokens)} />
        <Par k="sessoes" v={String(account.sessions)} />
      </div>

      {/* Dois medidores, e nao um. O de cima e tempo decorrido da janela;
          o de baixo e quanto do consumo das tres contas e desta. Uma barra
          sozinha ao lado de numeros de token era lida como "cota gasta",
          quando media so a passagem do tempo — a conta podia estar com a
          barra cheia sem ter gasto quase nada.

          O til marca estimativa: o inicio da janela e deduzido da mensagem
          mais antiga das ultimas 5h, e so vira medida quando um 429 grava
          o resetsAt de verdade no transcript. */}
      <div className="arow__medidores">
        <Medidor
          k="tempo"
          pct={elapsed}
          valor={`${estimado ? '~' : ''}${Math.round(elapsed * 100)}%`}
          titulo={
            estimado
              ? 'inicio da janela deduzido do uso mais antigo; vira medida quando a API informa o reset'
              : 'reset informado pela propria API'
          }
        />
        <Medidor
          k="gasto"
          pct={fatia / 100}
          valor={`${fatia.toFixed(1)}%`}
          titulo="fatia desta conta no consumo das tres"
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
  // Duas contas diferentes, e o painel precisa das duas:
  //  - trabalho = entrada + saida, o que de fato foi escrito e lido de novo;
  //  - quota    = trabalho + cache, que e o que consome a janela de 5h.
  // Medido nesta maquina, o cache e ~99,7% da quota, entao o numero unico de
  // antes era, na pratica, "cache relido" — nao o trabalho.
  const trabalho = accounts.reduce((t, a) => t + a.inputTokens + a.outputTokens, 0)
  const quota = accounts.reduce((t, a) => t + a.tokensUsed, 0)
  const projetos = junta(accounts, (a) => a.porProjeto)
  const modelos = junta(accounts, (a) => a.porModelo)
  const ativa = accounts.find((a) => a.active)
  const ritmo = ativa ? ritmoDaJanela(ativa, now) : null

  const linha = (fatias: Fatia[]) =>
    fatias.length === 0
      ? '--'
      : fatias
          .slice(0, 2)
          .map((f) => `${f.nome} ${quota === 0 ? 0 : Math.round((f.tokens / quota) * 100)}%`)
          .join(' · ') + (fatias.length > 2 ? ` +${fatias.length - 2}` : '')

  return (
    <div className="destino">
      <h5 className="destino__t">destino e ritmo</h5>
      <div className="destino__kv">
        <span>projeto</span>
        <b>{linha(projetos)}</b>
        <span>modelo</span>
        <b>{linha(modelos)}</b>
        {/* A quota fica aqui, longe do numero grande: e ela que enche a
            janela de 5h, mas nao e trabalho novo. */}
        <span title="entrada + saida + cache; e o que consome a janela de 5h">
          quota usada
        </span>
        <b>{formatTokens(quota)}</b>
        <span>trabalho</span>
        <b>{formatTokens(trabalho)}</b>
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
