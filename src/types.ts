export type AccountId = 1 | 2 | 3

export const WINDOW_MS = 5 * 60 * 60 * 1000

/** Espelha o AccountSummary do servidor. */
/** Trecho em que uma conta esteve ativa. `to` null e o periodo atual. */
export interface Periodo {
  accountId: AccountId
  from: number
  to: number | null
}

/** Um teto da API, com o quanto dele ja foi usado. */
export interface Limite {
  usadoPct: number
  resetaEm: number | null
}

export interface QuotaDaSessao {
  sessionId: string
  lidaEm: number
  cincoHoras: Limite | null
  seteDias: Limite | null
  contextoPct: number | null
}

/** Quanto uma origem consumiu na janela: serve para modelo e para projeto. */
export interface Fatia {
  nome: string
  tokens: number
}

export interface Account {
  id: AccountId
  label: string
  email: string | null
  /** Se ja existe token de longa duracao valido para esta conta. */
  hasToken: boolean
  /** Por que o token nao serve, quando nao serve. */
  tokenIssue: 'missing' | 'malformed' | 'truncated' | null
  active: boolean
  windowStartedAt: number | null
  resetAt: number | null
  /** 'observed' = lido do terminal; 'estimated' = inicio da janela mais 5h. */
  resetSource: 'observed' | 'estimated'
  tokensUsed: number
  /** O mesmo total repartido: entrada, saida e cache somam tokensUsed. */
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  /** Consumo por modelo na janela, do maior para o menor. */
  porModelo: Fatia[]
  /** Consumo por projeto na janela, do maior para o menor. */
  porProjeto: Fatia[]
  /** Consumo por fatia da janela de 5h, para o sparkline. */
  series: number[]
  /** Quando a conta foi cobrada pela ultima vez nesta janela. */
  lastUsedAt: number | null
  /** Maior consumo numa unica fatia de 10 minutos. */
  peakTokens: number
  sessions: number
  rateLimited: boolean
  /** Trecho do terminal que disparou o alerta. */
  limitEvidence: string | null
  /** Cota real desta conta, do statusline. Null sem leitura atribuivel. */
  quota: QuotaDaSessao | null
}

export interface TerminalTab {
  id: string
  title: string
  cwd: string
}

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'

/** Operacao do git deixada pela metade no diretorio. */
export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect'

export interface GitFile {
  path: string
  status: GitFileStatus
  staged: boolean
  added: number
  removed: number
}

export interface GitState {
  repo: boolean
  branch: string
  /** HEAD destacado: `branch` traz o hash curto, nao um nome de ramo. */
  detached: boolean
  /** Repo iniciado e ainda sem nenhum commit. */
  unborn: boolean
  /** Operacao pela metade, quando ha uma. */
  operation: GitOperation | null
  /** Tem .git, mas o git recusa ler. Diferente de nao ser repo. */
  broken: string | null
  ahead: number
  behind: number
  files: GitFile[]
  truncated: boolean
}

export type DiffLineKind = 'add' | 'remove' | 'context' | 'hunk'
export type ChangeSource = 'file-history' | 'git'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  lineNo: number | null
}

export interface ChangedFile {
  path: string
  added: number
  removed: number
  touchedAt: number | null
  tool: 'Edit' | 'Write' | 'NotebookEdit' | null
  source: ChangeSource
  lines: DiffLine[]
}

export interface ChangesResult {
  sessionId: string | null
  cwd: string
  files: ChangedFile[]
  totals: { added: number; removed: number }
}

export type ViewName = 'accounts' | 'fleet' | 'git' | 'diff' | 'history' | 'settings'

export interface SessaoViva {
  pid: number
  sessionId: string
  nome: string
  projeto: string
  cwd: string
  kind: string
  versao: string
  estado: 'busy' | 'idle'
  iniciadaEm: number
  desdeMs: number
  ehEstaAba: boolean
}

export interface TarefaDeFundo {
  id: string
  nome: string
  projeto: string
  estado: string
  criadaEm: number
  atualizadaEm: number
}

export interface Frota {
  sessoes: SessaoViva[]
  tarefas: TarefaDeFundo[]
}

export interface ModeloDaSessao {
  nome: string
  tokens: number
  custoUSD: number
}

export interface ResumoDeSessao {
  sessionId: string
  titulo: string | null
  projeto: string
  cwd: string
  iniciadaEm: number
  atualizadaEm: number
  duracaoMs: number
  /** Custo equivalente: no plano Pro nada disso e cobrado. */
  custoUSD: number
  entrada: number
  saida: number
  cache: number
  tokens: number
  linhasAdicionadas: number
  linhasRemovidas: number
  mensagens: number
  modelos: ModeloDaSessao[]
}

export interface Historico {
  sessoes: ResumoDeSessao[]
  totais: {
    sessoes: number
    custoUSD: number
    duracaoMs: number
    tokens: number
    entrada: number
    saida: number
    linhasAdicionadas: number
    linhasRemovidas: number
  }
  projetos: { nome: string; custoUSD: number; tokens: number; sessoes: number }[]
}
