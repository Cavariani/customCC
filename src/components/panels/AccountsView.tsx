import { useWorkspace } from '../../lib/workspace'
import { useNow } from '../../lib/useNow'
import { useCountUp } from '../../lib/useCountUp'
import {
  STATUS_LABEL,
  formatAgo,
  formatTokens,
  getStatus,
  msUntilReset,
  ritmoDaJanela,
} from '../../lib/format'
import type { Account, Fatia, Quota } from '../../types'

const TOKEN_ISSUE: Record<string, string> = {
  missing: 'CLAUDE_TOKEN nao encontrado no arquivo',
  malformed: 'token com espaco ou quebra de linha, ou sem prefixo sk-ant-oat',
  truncated: 'token curto demais, provavelmente cortado ao colar',
}

// As animacoes ja tem interruptor global em [data-animations='false'], entao
// o bloco nao precisa carregar a preferencia ate cada linha.
export function AccountsView() {
  const { accounts, switching, switchAccount, quota } = useWorkspace()
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

      {/* A unica medida do painel que conhece o proprio teto. Todo o resto
          conta tokens, e token sem teto nao diz quanto falta. Vem do JSON
          que o Claude Code entrega ao statusline, guardado pelo hook em
          ~/.claude/statusline-quota.sh. */}
      <CotaReal quota={quota} agora={now} />

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

/**
 * Quanto falta para a janela virar, em h:mm:ss descendo ate 00:00.
 *
 * O relogio do reset sozinho obriga a fazer a conta de cabeca; o contador
 * responde direto. E ele que substituiu a barra de tempo: com as tres
 * janelas abrindo juntas, todas marcavam entre 96% e 100% e a barra nao
 * distinguia uma da outra, enquanto os minutos restantes distinguem.
 */
function regressivo(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Verde nos ultimos minutos: e quando a conta esta prestes a voltar. */
function tomDoContador(ms: number): string {
  const min = ms / 60000
  if (min <= 10) return 'quase'
  if (min <= 45) return 'perto'
  return 'longe'
}

/**
 * Cota da API: os mesmos numeros do /usage.
 *
 * So aparece quando o hook do statusline ja escreveu alguma vez. E ele que
 * define a frescura do dado: o valor so muda quando alguma sessao desenha
 * a barra de status, entao a idade da leitura vai junto quando envelhece.
 */
function CotaReal({ quota, agora }: { quota: Quota | null; agora: number }) {
  const q = quota?.atual
  if (!q || (!q.cincoHoras && !q.seteDias)) return null

  const idade = agora - q.lidaEm
  const velha = idade > 5 * 60_000

  return (
    <div className="cota">
      <div className="cota__cols">
        <span>cota da api</span>
        {velha && <span className="cota__velha">ha {formatAgo(idade)}</span>}
      </div>
      {q.cincoHoras && <Trilho k="5 horas" l={q.cincoHoras} agora={agora} />}
      {q.seteDias && <Trilho k="7 dias" l={q.seteDias} agora={agora} />}
    </div>
  )
}

function Trilho({
  k,
  l,
  agora,
}: {
  k: string
  l: { usadoPct: number; resetaEm: number | null }
  agora: number
}) {
  // Acima de 80% a barra muda de cor: e o unico lugar do painel onde da
  // para dizer "esta acabando", porque e o unico com teto conhecido.
  const tom = l.usadoPct >= 80 ? 'alto' : l.usadoPct >= 50 ? 'medio' : 'baixo'
  const resta = l.resetaEm === null ? null : Math.max(0, l.resetaEm - agora)

  return (
    <div className="cota__linha">
      <span className="cota__k">{k}</span>
      <span className="cota__trilho">
        <span className={`cota__fill cota__fill--${tom}`} style={{ width: `${l.usadoPct}%` }} />
      </span>
      <b className={`cota__v cota__v--${tom}`}>{Math.round(l.usadoPct)}%</b>
      {resta !== null && <span className="cota__reset">{regressivo(resta)}</span>}
    </div>
  )
}

/** Horario local no formato 24h, que e como o Pedro le a hora. */
function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** O reset com o contador ao lado, que e o par mais lido da grade. */
function Reinicia({ account, now }: { account: Account; now: number }) {
  const resta = msUntilReset(account, now)
  return (
    <div className="par">
      <span className="par__k">reinicia</span>
      <b className="par__v">
        {account.resetAt === null ? '--:--' : clockOf(account.resetAt)}
        {resta !== null && (
          <span className={`par__cr par__cr--${tomDoContador(resta)}`}> {regressivo(resta)}</span>
        )}
      </b>
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
  switching: boolean
  onSwitch: () => void
}

function Row({ account, now, switching, onSwitch }: RowProps) {
  const status = getStatus(account, now)
  const isActive = account.active
  // A conta mostra o mesmo que o numero grande: entrada + saida. O cache
  // fica na grade, para a quota continuar derivavel sem dominar a leitura.
  const tokens = useCountUp(account.inputTokens + account.outputTokens)
  const resta = msUntilReset(account, now)
  const bloqueada = account.rateLimited

  // A linha de baixo da acao. "livre por X" estava errado e dizia o
  // oposto do que acontece: no reset o consumo da janela volta a zero, ou
  // seja, a conta melhora — nao para de servir. Numa conta bloqueada o
  // mesmo instante e quando ela volta, entao o texto muda com o estado.
  // Zerado nao vira "reseta em 00:00": a frase perde o sentido no instante
  // em que o numero chega la, e o botao fica melhor so com o rotulo.
  const legenda =
    resta === null || resta < 1000
      ? null
      : bloqueada
        ? `volta em ${regressivo(resta)}`
        : `reseta em ${regressivo(resta)}`

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
        <Reinicia account={account} now={now} />
        <Par
          k="ultimo"
          v={account.lastUsedAt === null ? '--' : formatAgo(now - account.lastUsedAt)}
        />
        <Par k="entrada" v={formatTokens(account.inputTokens)} />
        <Par k="saida" v={formatTokens(account.outputTokens)} />
        <Par k="cache" v={formatTokens(account.cacheTokens)} />
        <Par k="sessoes" v={String(account.sessions)} />
      </div>

      {/* A acao ocupa a folga da linha, em vez de ser uma tira de 18px, e
          leva embaixo o que a barra tentava dizer: por quanto tempo aquela
          conta ainda serve. Palavra em vez de proporcao — "livre por 11min"
          se le sem decodificar, "96%" nao. A ativa mostra o estado no mesmo
          lugar, entao as tres linhas continuam com a mesma altura. */}
      <div className="arow__rod">
        {isActive ? (
          <span className="arow__acao arow__acao--uso">
            <b>em uso</b>
            {legenda && <small>{legenda}</small>}
          </span>
        ) : (
          <button
            type="button"
            className={`arow__acao${bloqueada ? ' arow__acao--bloq' : ''}`}
            disabled={switching}
            onClick={onSwitch}
            title={
              account.tokenIssue === null
                ? undefined
                : `sem token valido: ${TOKEN_ISSUE[account.tokenIssue]}`
            }
          >
            <b>{account.tokenIssue === null ? 'logar' : 'logar sem token'}</b>
            {legenda && <small>{legenda}</small>}
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
