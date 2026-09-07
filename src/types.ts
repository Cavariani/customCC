export type AccountId = 1 | 2 | 3

export const WINDOW_MS = 5 * 60 * 60 * 1000

/** Espelha o AccountSummary do servidor. */
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
}

export interface TerminalTab {
  id: string
  title: string
  cwd: string
}

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

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

export type ViewName = 'accounts' | 'git' | 'diff' | 'settings'
