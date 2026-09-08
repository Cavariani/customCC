import { realpathSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const CLAUDE_HOME = join(homedir(), '.claude')
const PROJECTS_DIR = join(CLAUDE_HOME, 'projects')
export const FILE_HISTORY_DIR = join(CLAUDE_HOME, 'file-history')

/**
 * O Claude Code guarda os transcripts em ~/.claude/projects/<slug>, onde o
 * slug e o caminho absoluto com todo caractere nao alfanumerico virando
 * hifen. Verificado contra os diretorios reais: "Programacao" com cedilha e
 * til vira "Programa--o". A regra e lossy, mas e a dele, entao copiamos.
 */
export function projectSlug(cwd: string): string {
  // Duas armadilhas de caminho, as duas ja custaram bug:
  // - normalize('NFC'): o macOS entrega em NFD, onde a cedilha e um
  //   combinante separado, e o slug sairia "Programac-a-o" no lugar de
  //   "Programa--o", que e o que o Claude Code criou no disco.
  // - realpath: o `claude` resolve symlink ao nascer, entao /tmp/projeto
  //   vira -private-tmp-projeto. Sem resolver, procuravamos numa pasta que
  //   nunca existiu.
  let real = resolve(cwd)
  try {
    real = realpathSync(real)
  } catch {
    /* caminho pode nao existir mais; segue com o resolvido */
  }
  return real.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-')
}

export interface BackupRef {
  /** Caminho relativo ao projeto, como o transcript registra. */
  trackingPath: string
  /** Diretorio real do arquivo, para remontar o caminho absoluto. */
  realParentDir: string
  /** Nome do arquivo de backup dentro de ~/.claude/file-history/<sessao>. */
  backupFileName: string
  version: number
}

export interface UsageEntry {
  timestamp: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** Modelo que atendeu. Opus e Sonnet pesam diferente na mesma janela. */
  model: string | null
}

/**
 * Recusa por limite registrada pelo proprio Claude Code na linha do
 * transcript. E a unica fonte autoritativa de reset que temos: o resto do
 * app estima (inicio da janela mais 5h) ou raspa do texto do terminal.
 * Aparece so no 429 — medido, em 0,2% das mensagens.
 */
export interface QuotaEvent {
  timestamp: number
  /** Epoch em milissegundos. O campo do arquivo vem em segundos. */
  resetsAt: number | null
  /** 'five_hour' na janela normal; guardado cru para nao mentir se mudar. */
  rateLimitType: string | null
  status: string | null
}

export interface ToolTouch {
  path: string
  tool: 'Edit' | 'Write' | 'NotebookEdit'
  timestamp: number
}

export interface TranscriptData {
  sessionId: string
  file: string
  cwd: string
  gitBranch: string | null
  startedAt: number
  updatedAt: number
  usage: UsageEntry[]
  /** Recusas por limite, com o reset que a propria API informou. */
  quota: QuotaEvent[]
  /** Backup de menor versao por arquivo: o estado antes da primeira edicao. */
  backups: Map<string, BackupRef>
  touches: ToolTouch[]
}

/** Sessoes de um projeto, da mais recente para a mais antiga. */
export async function listProjectSessions(cwd: string): Promise<
  { sessionId: string; file: string; mtime: number }[]
> {
  const dir = join(PROJECTS_DIR, projectSlug(cwd))
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }

  const found = await Promise.all(
    names
      .filter((n) => n.endsWith('.jsonl'))
      .map(async (name) => {
        const file = join(dir, name)
        const info = await stat(file)
        return { sessionId: name.replace(/\.jsonl$/, ''), file, mtime: info.mtimeMs }
      }),
  )
  return found.sort((a, b) => b.mtime - a.mtime)
}

/** Sessao ativa de um projeto: a que recebeu escrita mais recentemente. */
export async function findActiveSession(cwd: string) {
  const [latest] = await listProjectSessions(cwd)
  return latest ?? null
}

export async function readTranscript(
  file: string,
  sessionId: string,
): Promise<TranscriptData | null> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return null
  }

  const data: TranscriptData = {
    sessionId,
    file,
    cwd: '',
    gitBranch: null,
    startedAt: 0,
    updatedAt: 0,
    usage: [],
    quota: [],
    backups: new Map(),
    touches: [],
  }

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line)
    } catch {
      // Linha parcial: o Claude Code ainda estava escrevendo. Ignorar e ok.
      continue
    }

    const ts = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : 0
    if (ts) {
      if (!data.startedAt) data.startedAt = ts
      data.updatedAt = Math.max(data.updatedAt, ts)
    }
    if (typeof entry.cwd === 'string' && !data.cwd) data.cwd = entry.cwd
    if (typeof entry.gitBranch === 'string') data.gitBranch = entry.gitBranch

    collectUsage(entry, ts, data)
    collectQuota(entry, ts, data)
    collectTouches(entry, ts, data)
    collectBackups(entry, data)
  }

  return data
}

function collectUsage(entry: Record<string, unknown>, ts: number, data: TranscriptData) {
  if (entry.type !== 'assistant') return
  const message = entry.message as
    | { usage?: Record<string, number>; model?: unknown }
    | undefined
  const usage = message?.usage
  if (!usage) return
  data.usage.push({
    timestamp: ts,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    model: typeof message?.model === 'string' ? message.model : null,
  })
}

function collectQuota(entry: Record<string, unknown>, ts: number, data: TranscriptData) {
  const quota = entry.quotaLimits
  if (typeof quota !== 'object' || quota === null) return
  const q = quota as { resetsAt?: unknown; rateLimitType?: unknown; status?: unknown }

  // resetsAt vem em segundos; o resto do app trabalha em milissegundos.
  // Multiplicar sem conferir transformaria um valor ausente em 1 de janeiro
  // de 1970, que passaria por "reset no passado" e limparia o estado.
  const segundos = typeof q.resetsAt === 'number' && Number.isFinite(q.resetsAt) ? q.resetsAt : null

  data.quota.push({
    timestamp: ts,
    resetsAt: segundos === null ? null : segundos * 1000,
    rateLimitType: typeof q.rateLimitType === 'string' ? q.rateLimitType : null,
    status: typeof q.status === 'string' ? q.status : null,
  })
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

function collectTouches(entry: Record<string, unknown>, ts: number, data: TranscriptData) {
  if (entry.type !== 'assistant') return
  const message = entry.message as { content?: unknown } | undefined
  if (!Array.isArray(message?.content)) return
  for (const block of message.content) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as { type?: string; name?: string; input?: { file_path?: string } }
    if (b.type !== 'tool_use' || !b.name || !EDIT_TOOLS.has(b.name)) continue
    const path = b.input?.file_path
    if (typeof path === 'string') {
      data.touches.push({ path, tool: b.name as ToolTouch['tool'], timestamp: ts })
    }
  }
}

function collectBackups(entry: Record<string, unknown>, data: TranscriptData) {
  const remember = (trackingPath: string, backup: Record<string, unknown>) => {
    const backupFileName = backup.backupFileName
    const realParentDir = backup.realParentDir
    const version = Number(backup.version ?? 0)
    if (typeof backupFileName !== 'string' || typeof realParentDir !== 'string') return
    const current = data.backups.get(trackingPath)
    // Guardamos a menor versao: o conteudo anterior a primeira edicao da sessao.
    if (current && current.version <= version) return
    data.backups.set(trackingPath, { trackingPath, realParentDir, backupFileName, version })
  }

  if (entry.type === 'file-history-delta') {
    const backup = entry.backup as Record<string, unknown> | undefined
    if (backup && typeof entry.trackingPath === 'string') remember(entry.trackingPath, backup)
    return
  }

  if (entry.type === 'file-history-snapshot') {
    const snapshot = entry.snapshot as { trackedFileBackups?: Record<string, unknown> } | undefined
    const tracked = snapshot?.trackedFileBackups
    if (!tracked) return
    for (const [trackingPath, backup] of Object.entries(tracked)) {
      if (backup && typeof backup === 'object') {
        remember(trackingPath, backup as Record<string, unknown>)
      }
    }
  }
}
