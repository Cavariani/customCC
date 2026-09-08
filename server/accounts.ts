import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readTranscript, type QuotaEvent } from './transcript.js'

export const STATE_DIR = join(homedir(), '.claude-multi-account')
const STATE_FILE = join(STATE_DIR, 'state.json')
const TOKENS_FILE = join(STATE_DIR, '.env')

export const WINDOW_MS = 5 * 60 * 60 * 1000
/** Fatias do grafico de consumo: uma a cada 10 minutos da janela. */
const SERIES_BUCKETS = 30
export const ACCOUNT_IDS = [1, 2, 3] as const
export type AccountId = (typeof ACCOUNT_IDS)[number]

interface AccountRecord {
  windowStartedAt: number | null
  rateLimitedAt: number | null
  /** Reset lido do proprio terminal, mais confiavel que a estimativa. */
  observedResetAt: number | null
  /** Trecho que disparou a deteccao, para a UI justificar o alerta. */
  evidence: string | null
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
  return { windowStartedAt: null, rateLimitedAt: null, observedResetAt: null, evidence: null }
}

let cache: State | null = null

/** Objeto de verdade: null e lista tambem passam pelo typeof 'object'. */
function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function ehConta(v: unknown): v is AccountId {
  return v === 1 || v === 2 || v === 3
}

/**
 * O arquivo de estado e editado a mao de vez em quando e sobrevive a
 * versoes diferentes do app, entao nada dentro dele pode ser tomado como
 * certo. Um `activeAccountId` fora de 1..3 vazava ate a API e deixava o
 * painel sem nenhuma conta ativa, porque nenhuma casava com o valor.
 */
function sanear(parsed: unknown): State {
  if (!ehObjeto(parsed)) return structuredClone(EMPTY_STATE)

  const contas = ehObjeto(parsed.accounts) ? parsed.accounts : {}
  const saneadas = structuredClone(EMPTY_STATE.accounts)
  for (const id of ACCOUNT_IDS) {
    const bruta = contas[id] ?? contas[String(id)]
    if (ehObjeto(bruta)) saneadas[id] = { ...blank(), ...(bruta as Partial<AccountRecord>) }
  }

  return {
    activeAccountId: ehConta(parsed.activeAccountId) ? parsed.activeAccountId : 1,
    accounts: saneadas,
    // periods precisa ser lista: accountAt percorre por indice, e uma string
    // aqui fazia o laco rodar sobre os caracteres dela.
    periods: Array.isArray(parsed.periods) ? (parsed.periods as State['periods']) : [],
    transcripts: ehObjeto(parsed.transcripts) ? (parsed.transcripts as State['transcripts']) : {},
  }
}

export async function loadState(): Promise<State> {
  if (cache) return cache
  let raw: string
  try {
    raw = await readFile(STATE_FILE, 'utf8')
  } catch {
    // Ainda nao existe: primeiro uso, nao e erro.
    cache = structuredClone(EMPTY_STATE)
    return cache
  }

  try {
    cache = sanear(JSON.parse(raw))
  } catch {
    // O arquivo existe e nao e JSON. Comecar do zero em cima dele apagaria
    // o historico de janelas na primeira gravacao, em silencio; guardamos a
    // copia para dar chance de recuperar o que estava la.
    const backup = `${STATE_FILE}.corrompido-${Date.now()}`
    try {
      await rename(STATE_FILE, backup)
      console.error(`[customcc] state.json ilegivel; copia guardada em ${backup}`)
    } catch (erro) {
      console.error('[customcc] state.json ilegivel e nao foi possivel guardar copia:', erro)
    }
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

/** Um ponto de consumo: o total e a reparticao dele. */
export interface UsagePoint {
  timestamp: number
  tokens: number
  input: number
  output: number
  cache: number
}

interface TranscriptCacheEntry {
  mtime: number
  totals: UsagePoint[]
  quota: QuotaEvent[]
}

const transcriptCache = new Map<string, TranscriptCacheEntry>()

/** Tokens por mensagem, com timestamp, relidos so quando o arquivo muda. */
async function usageTimeline(file: string, sessionId: string) {
  let mtime = 0
  try {
    mtime = (await stat(file)).mtimeMs
  } catch {
    return { mtime: 0, totals: [], quota: [] }
  }

  const cached = transcriptCache.get(file)
  if (cached && cached.mtime === mtime) return cached

  const transcript = await readTranscript(file, sessionId)
  const totals = (transcript?.usage ?? []).map((u) => ({
    timestamp: u.timestamp,
    // Cache de leitura entra no total porque tambem conta para o limite.
    tokens: u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens,
    // Os quatro seguem separados tambem: medido nos transcripts reais, o
    // cache de leitura e ~98% do total, entao o numero somado sozinho diz
    // pouco sobre o que a conta realmente gastou.
    input: u.inputTokens,
    output: u.outputTokens,
    cache: u.cacheReadTokens + u.cacheCreationTokens,
  }))
  const entrada: TranscriptCacheEntry = { mtime, totals, quota: transcript?.quota ?? [] }
  transcriptCache.set(file, entrada)
  return entrada
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
  /** Se o reset veio do terminal ou e a estimativa de inicio mais 5h. */
  resetSource: 'observed' | 'estimated'
  tokensUsed: number
  /** O mesmo total repartido: entrada, saida e cache somam tokensUsed. */
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  /** Consumo por fatia da janela, para o sparkline. */
  series: number[]
  /** Quando a conta foi cobrada pela ultima vez nesta janela. */
  lastUsedAt: number | null
  /** Maior consumo numa unica fatia de 10 minutos. */
  peakTokens: number
  sessions: number
  rateLimited: boolean
  limitEvidence: string | null
}

export async function summarizeAccounts(): Promise<AccountSummary[]> {
  const state = await loadState()
  const tokens = await loadTokens()
  const now = Date.now()

  // Passo 1: distribuir cada mensagem na conta que estava ativa no instante
  // dela, sem filtrar por janela ainda. Filtrar antes era o bug: a conta
  // recem-ativada nao tinha janela aberta, e todo o consumo dela era
  // descartado em silencio.
  const pontos: Record<number, (UsagePoint & { sessionId: string })[]> = {
    1: [], 2: [], 3: [],
  }

  const recusas: Record<number, QuotaEvent[]> = { 1: [], 2: [], 3: [] }
  let mudouPorQuota = false

  for (const [sessionId, ref] of Object.entries(state.transcripts)) {
    const { totals, quota } = await usageTimeline(ref.file, sessionId)
    for (const point of totals) {
      const dono = accountAt(state, point.timestamp)
      if (dono === null) continue
      pontos[dono].push({ ...point, sessionId })
    }
    for (const evento of quota) {
      const dono = accountAt(state, evento.timestamp)
      if (dono === null) continue
      recusas[dono].push(evento)
    }
  }

  // Passo 1.5: o reset que a propria API informou vale mais que qualquer
  // estimativa nossa. Precisa entrar antes do passo 2, que decide a janela
  // lendo justamente o observedResetAt.
  //
  // So conta recusa cujo reset ainda esta no futuro: um 429 de tres dias
  // atras nao diz nada sobre a janela de agora.
  for (const id of ACCOUNT_IDS) {
    const valida = recusas[id]
      .filter((e) => e.status === 'rejected' && e.resetsAt !== null && e.resetsAt > now)
      .sort((a, b) => b.timestamp - a.timestamp)[0]
    if (!valida) continue

    const record = state.accounts[id] ?? blank()
    if (record.observedResetAt === valida.resetsAt && record.rateLimitedAt !== null) continue
    record.observedResetAt = valida.resetsAt
    record.rateLimitedAt = valida.timestamp
    record.evidence = `recusa ${valida.rateLimitType ?? 'de limite'} registrada pelo proprio Claude Code`
    state.accounts[id] = record
    mudouPorQuota = true
  }

  // Passo 2: decidir a janela de cada conta. Quando ha consumo recente sem
  // janela aberta (troca de conta retomando uma sessao ja descoberta, que
  // nunca passa por registerTranscript de novo), a janela comeca na
  // mensagem mais antiga ainda dentro das ultimas 5h.
  let mudou = mudouPorQuota
  const janelas = new Map<AccountId, { start: number | null; end: number | null }>()

  for (const id of ACCOUNT_IDS) {
    const record = state.accounts[id] ?? blank()
    const expirada = record.windowStartedAt !== null && now - record.windowStartedAt > WINDOW_MS
    let start = expirada ? null : record.windowStartedAt

    if (start === null) {
      const recentes = pontos[id].filter((p) => now - p.timestamp <= WINDOW_MS)
      if (recentes.length > 0) {
        start = Math.min(...recentes.map((p) => p.timestamp))
        record.windowStartedAt = start
        record.rateLimitedAt = expirada ? null : record.rateLimitedAt
        state.accounts[id] = record
        mudou = true
      }
    }

    // O reset visto no terminal vale mais que inicio da janela mais 5h.
    const observado =
      record.observedResetAt !== null && record.observedResetAt > now ? record.observedResetAt : null
    janelas.set(id, { start, end: observado ?? (start === null ? null : start + WINDOW_MS) })
  }

  if (mudou) await saveState(state)

  // Passo 3: somar so o que cai dentro da janela de cada conta.
  const used: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
  const usedIn: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
  const usedOut: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
  const usedCache: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
  const lastAt: Record<number, number | null> = { 1: null, 2: null, 3: null }
  const sessionCount: Record<number, Set<string>> = { 1: new Set(), 2: new Set(), 3: new Set() }
  const buckets: Record<number, number[]> = {
    1: new Array(SERIES_BUCKETS).fill(0),
    2: new Array(SERIES_BUCKETS).fill(0),
    3: new Array(SERIES_BUCKETS).fill(0),
  }

  for (const id of ACCOUNT_IDS) {
    const janela = janelas.get(id)!
    if (janela.start === null) continue
    const fim = janela.end ?? now

    for (const ponto of pontos[id]) {
      if (ponto.timestamp < janela.start || ponto.timestamp > fim) continue
      used[id] += ponto.tokens
      usedIn[id] += ponto.input
      usedOut[id] += ponto.output
      usedCache[id] += ponto.cache
      sessionCount[id].add(ponto.sessionId)
      if (lastAt[id] === null || ponto.timestamp > lastAt[id]!) lastAt[id] = ponto.timestamp

      const span = fim - janela.start
      if (span > 0) {
        const fatia = Math.min(
          SERIES_BUCKETS - 1,
          Math.floor(((ponto.timestamp - janela.start) / span) * SERIES_BUCKETS),
        )
        buckets[id][fatia] += ponto.tokens
      }
    }
  }

  return ACCOUNT_IDS.map((id) => {
    const record = state.accounts[id] ?? blank()
    const janela = janelas.get(id)!
    const entry = tokens.get(id)
    const tokenIssue = inspectToken(entry?.token)
    const aindaLimitada =
      record.rateLimitedAt !== null &&
      (record.observedResetAt === null || record.observedResetAt > now)

    return {
      id,
      label: entry?.label ?? `conta ${id}`,
      email: entry?.email ?? null,
      hasToken: tokenIssue === null,
      tokenIssue,
      active: state.activeAccountId === id,
      windowStartedAt: janela.start,
      resetAt: janela.end,
      resetSource:
        record.observedResetAt !== null && record.observedResetAt > now
          ? ('observed' as const)
          : ('estimated' as const),
      tokensUsed: used[id],
      inputTokens: usedIn[id],
      outputTokens: usedOut[id],
      cacheTokens: usedCache[id],
      series: buckets[id],
      lastUsedAt: lastAt[id],
      peakTokens: Math.max(0, ...buckets[id]),
      sessions: sessionCount[id].size,
      rateLimited: aindaLimitada,
      limitEvidence: aindaLimitada ? record.evidence : null,
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

export async function markRateLimited(
  id: AccountId,
  options: { resetAt?: number | null; evidence?: string } = {},
): Promise<void> {
  const state = await loadState()
  const record = state.accounts[id] ?? blank()
  record.rateLimitedAt = Date.now()
  if (options.resetAt) record.observedResetAt = options.resetAt
  if (options.evidence) record.evidence = options.evidence
  state.accounts[id] = record
  await saveState(state)
}

/** O terminal avisou que a janela virou, ou o horario do reset passou. */
export async function clearRateLimited(id: AccountId): Promise<void> {
  const state = await loadState()
  const record = state.accounts[id] ?? blank()
  record.rateLimitedAt = null
  record.observedResetAt = null
  record.evidence = null
  // A janela recomeca do zero: o consumo anterior nao conta mais.
  record.windowStartedAt = null
  state.accounts[id] = record
  await saveState(state)
}

/** Horario de reset visto no terminal, sem que a conta esteja bloqueada. */
export async function noteResetHint(id: AccountId, resetAt: number): Promise<void> {
  const state = await loadState()
  const record = state.accounts[id] ?? blank()
  if (record.observedResetAt === resetAt) return
  record.observedResetAt = resetAt
  state.accounts[id] = record
  await saveState(state)
}
