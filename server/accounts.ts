import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readTranscript } from './transcript.js'

export const STATE_DIR = join(homedir(), '.claude-multi-account')
const STATE_FILE = join(STATE_DIR, 'state.json')
const TOKENS_FILE = join(STATE_DIR, '.env')

export const WINDOW_MS = 5 * 60 * 60 * 1000
export const ACCOUNT_IDS = [1, 2, 3] as const
export type AccountId = (typeof ACCOUNT_IDS)[number]

interface AccountRecord {
  windowStartedAt: number | null
  rateLimitedAt: number | null
}

interface TranscriptRef {
  file: string
  cwd: string
}

/**
 * Intervalo em que uma conta esteve ativa. Atribuir tokens por periodo, e
 * nao por sessao, e o que mantem a conta certa quando a mesma sessao e
 * retomada com `--continue` sob outra conta depois de uma troca.
 */
interface Period {
  accountId: AccountId
  from: number
  to: number | null
}

interface State {
  activeAccountId: AccountId
  accounts: Record<string, AccountRecord>
  periods: Period[]
  /** Transcripts que este servidor viu, por sessao do Claude Code. */
  transcripts: Record<string, TranscriptRef>
}

const EMPTY_STATE: State = {
  activeAccountId: 1,
  accounts: { 1: blank(), 2: blank(), 3: blank() },
  periods: [],
  transcripts: {},
}

function blank(): AccountRecord {
  return { windowStartedAt: null, rateLimitedAt: null }
}

let cache: State | null = null

export async function loadState(): Promise<State> {
  if (cache) return cache
  try {
    const raw = await readFile(STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<State>
    cache = {
      activeAccountId: (parsed.activeAccountId ?? 1) as AccountId,
      accounts: { ...EMPTY_STATE.accounts, ...(parsed.accounts ?? {}) },
      periods: parsed.periods ?? [],
      transcripts: parsed.transcripts ?? {},
    }
  } catch {
    cache = structuredClone(EMPTY_STATE)
  }
  return cache
}

export async function saveState(next: State): Promise<void> {
  cache = next
  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(STATE_FILE, JSON.stringify(next, null, 2), 'utf8')
}

/**
 * Le os tokens de longa duracao gerados por `claude setup-token`, um por
 * conta. O arquivo vive fora do repositorio e o valor nunca sai daqui: so o
 * subprocesso `claude` o recebe, via variavel de ambiente.
 */
export interface TokenEntry {
  token: string
  label?: string
  email?: string
}

/** O que ha de errado com o token de uma conta, sem expor o valor dele. */
export type TokenIssue = 'missing' | 'malformed' | 'truncated' | null

/**
 * Tokens do `claude setup-token` sao uma unica palavra, sem espaco e sem
 * quebra de linha. Colar de um lugar que quebrou a linha e o erro mais
 * comum, e ele falharia silenciosamente na autenticacao, entao vale acusar
 * aqui com o motivo exato.
 */
export function inspectToken(value: string | undefined): TokenIssue {
  if (!value) return 'missing'
  if (/\s/.test(value)) return 'malformed'
  if (!value.startsWith('sk-ant-oat')) return 'malformed'
  if (value.length < 80) return 'truncated'
  return null
}

export async function loadTokens(): Promise<Map<AccountId, TokenEntry>> {
  const map = new Map<AccountId, TokenEntry>()
  let raw: string
  try {
    raw = await readFile(TOKENS_FILE, 'utf8')
  } catch {
    return map
  }

  const values = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    values.set(key, value)
  }

  for (const id of ACCOUNT_IDS) {
    const token = values.get(`CLAUDE_TOKEN_${id}`)
    map.set(id, {
      token: token ?? '',
      label: values.get(`ACCOUNT_${id}_LABEL`),
      email: values.get(`ACCOUNT_${id}_EMAIL`),
    })
  }
  return map
}

/** Abre um periodo para a conta ativa, se ainda nao houver um aberto. */
async function ensureOpenPeriod(state: State): Promise<void> {
  const open = state.periods.at(-1)
  if (open && open.to === null && open.accountId === state.activeAccountId) return
  if (open && open.to === null) open.to = Date.now()
  state.periods.push({ accountId: state.activeAccountId, from: Date.now(), to: null })
}

/** Qual conta estava ativa num instante. */
function accountAt(state: State, timestamp: number): AccountId | null {
  for (let i = state.periods.length - 1; i >= 0; i--) {
    const p = state.periods[i]
    if (timestamp >= p.from && (p.to === null || timestamp <= p.to)) return p.accountId
  }
  return null
}

/**
 * Registra um transcript para que a quota passe a somar o uso dele. A conta
 * dona de cada mensagem sai do periodo em que a mensagem caiu, entao uma
 * sessao retomada sob outra conta ja debita no lugar certo.
 */
export async function registerTranscript(
  sessionId: string,
  file: string,
  cwd: string,
): Promise<void> {
  const state = await loadState()
  const known = state.transcripts[sessionId]
  await ensureOpenPeriod(state)

  const record = state.accounts[state.activeAccountId] ?? blank()
  const now = Date.now()
  // Primeiro uso da conta na janela: e aqui que as 5h comecam a contar.
  if (record.windowStartedAt === null || now - record.windowStartedAt > WINDOW_MS) {
    record.windowStartedAt = now
    record.rateLimitedAt = null
  }
  state.accounts[state.activeAccountId] = record

  if (!known) state.transcripts[sessionId] = { file, cwd }
  await saveState(state)
}

interface TranscriptCacheEntry {
  mtime: number
  totals: { timestamp: number; tokens: number }[]
}

const transcriptCache = new Map<string, TranscriptCacheEntry>()

/** Tokens por mensagem, com timestamp, relidos so quando o arquivo muda. */
async function usageTimeline(file: string, sessionId: string) {
  let mtime = 0
  try {
    mtime = (await stat(file)).mtimeMs
  } catch {
    return []
  }

  const cached = transcriptCache.get(file)
  if (cached && cached.mtime === mtime) return cached.totals

  const transcript = await readTranscript(file, sessionId)
  const totals = (transcript?.usage ?? []).map((u) => ({
    timestamp: u.timestamp,
    // Cache de leitura entra no total porque tambem conta para o limite.
    tokens: u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens,
  }))
  transcriptCache.set(file, { mtime, totals })
  return totals
}

export interface AccountSummary {
  id: AccountId
  label: string
  email: string | null
  hasToken: boolean
  tokenIssue: TokenIssue
  active: boolean
  windowStartedAt: number | null
  resetAt: number | null
  tokensUsed: number
  sessions: number
  rateLimited: boolean
}

export async function summarizeAccounts(): Promise<AccountSummary[]> {
  const state = await loadState()
  const tokens = await loadTokens()
  const now = Date.now()

  // Uma varredura so nos transcripts, distribuindo cada mensagem na conta
  // que estava ativa naquele instante.
  const used: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
  const sessionCount: Record<number, Set<string>> = { 1: new Set(), 2: new Set(), 3: new Set() }

  const windows = new Map<AccountId, { start: number | null; end: number | null }>()
  for (const id of ACCOUNT_IDS) {
    const record = state.accounts[id] ?? blank()
    const expired = record.windowStartedAt !== null && now - record.windowStartedAt > WINDOW_MS
    const start = expired ? null : record.windowStartedAt
    windows.set(id, { start, end: start === null ? null : start + WINDOW_MS })
  }

  for (const [sessionId, ref] of Object.entries(state.transcripts)) {
    const timeline = await usageTimeline(ref.file, sessionId)
    for (const point of timeline) {
      const owner = accountAt(state, point.timestamp)
      if (owner === null) continue
      const window = windows.get(owner)
      if (!window || window.start === null) continue
      if (point.timestamp < window.start || point.timestamp > (window.end ?? now)) continue
      used[owner] += point.tokens
      sessionCount[owner].add(sessionId)
    }
  }

  return ACCOUNT_IDS.map((id) => {
    const record = state.accounts[id] ?? blank()
    const window = windows.get(id)!
    const entry = tokens.get(id)
    const tokenIssue = inspectToken(entry?.token)
    const expired = window.start === null
    return {
      id,
      label: entry?.label ?? `conta ${id}`,
      email: entry?.email ?? null,
      hasToken: tokenIssue === null,
      tokenIssue,
      active: state.activeAccountId === id,
      windowStartedAt: window.start,
      resetAt: window.end,
      tokensUsed: used[id],
      sessions: sessionCount[id].size,
      rateLimited: !expired && record.rateLimitedAt !== null,
    }
  })
}

export async function getActiveAccountId(): Promise<AccountId> {
  return (await loadState()).activeAccountId
}

export async function setActiveAccountId(id: AccountId): Promise<void> {
  const state = await loadState()
  if (state.activeAccountId === id) return
  const open = state.periods.at(-1)
  if (open && open.to === null) open.to = Date.now()
  state.activeAccountId = id
  state.periods.push({ accountId: id, from: Date.now(), to: null })
  await saveState(state)
}

/** Token da conta, so para repassar ao subprocesso. Nunca vai para a UI. */
export async function tokenFor(id: AccountId): Promise<string | undefined> {
  const entry = (await loadTokens()).get(id)
  if (!entry || inspectToken(entry.token) !== null) return undefined
  return entry.token
}

export async function markRateLimited(id: AccountId): Promise<void> {
  const state = await loadState()
  const record = state.accounts[id] ?? blank()
  record.rateLimitedAt = Date.now()
  state.accounts[id] = record
  await saveState(state)
}
