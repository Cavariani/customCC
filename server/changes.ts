import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { parsePatch, structuredPatch } from 'diff'
import {
  FILE_HISTORY_DIR,
  findActiveSession,
  readTranscript,
  type TranscriptData,
} from './transcript.js'

const run = promisify(execFile)

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
  /**
   * De onde veio o diff. `file-history` compara com o backup anterior a
   * primeira edicao da sessao; `git` compara com o HEAD, e e o que pega
   * arquivo mexido por shell, que o file-history nao registra.
   */
  source: ChangeSource
  lines: DiffLine[]
}

export interface ChangesResult {
  sessionId: string | null
  cwd: string
  files: ChangedFile[]
  totals: { added: number; removed: number }
}

const CONTEXT = 3
const MAX_BYTES = 1_500_000
const MAX_FILES = 100

/**
 * Devolve o conteudo anterior a primeira edicao da sessao, quando o Claude
 * Code guardou um backup. E o que permite desfazer uma edicao mesmo em
 * arquivo que o git nunca viu.
 */
export async function backupContentFor(cwd: string, filePath: string): Promise<string | null> {
  const base = resolve(cwd)
  const session = await findActiveSession(base)
  if (!session) return null

  const transcript = await readTranscript(session.file, session.sessionId)
  if (!transcript) return null

  const wanted = resolve(base, filePath).normalize('NFC')
  for (const backup of transcript.backups.values()) {
    const absolute = resolve(backup.realParentDir, basenameOf(backup.trackingPath)).normalize('NFC')
    if (absolute !== wanted) continue
    return readMaybe(join(FILE_HISTORY_DIR, session.sessionId, backup.backupFileName))
  }
  return null
}

export async function readChanges(cwd: string): Promise<ChangesResult> {
  const base = resolve(cwd)
  const [fromHistory, session] = await Promise.all([
    historyChanges(base),
    findActiveSession(base),
  ])

  const byPath = new Map<string, ChangedFile>(fromHistory.map((f) => [f.path, f]))

  // O git preenche o que o file-history nao viu: tudo que foi escrito por
  // shell, script ou pela mao do proprio Pedro.
  for (const file of await gitChanges(base)) {
    if (!byPath.has(file.path)) byPath.set(file.path, file)
  }

  const files = [...byPath.values()]
    .sort((a, b) => (b.touchedAt ?? 0) - (a.touchedAt ?? 0) || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES)

  const totals = files.reduce(
    (acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
    { added: 0, removed: 0 },
  )

  return { sessionId: session?.sessionId ?? null, cwd: base, files, totals }
}

/* ── Fonte 1: backups que o Claude Code guarda antes de cada edicao ─────── */

async function historyChanges(base: string): Promise<ChangedFile[]> {
  const session = await findActiveSession(base)
  if (!session) return []

  const transcript = await readTranscript(session.file, session.sessionId)
  if (!transcript) return []

  const backupDir = join(FILE_HISTORY_DIR, session.sessionId)
  const lastTouch = lastTouchByPath(transcript)
  const files: ChangedFile[] = []

  for (const backup of transcript.backups.values()) {
    const absolute = resolve(backup.realParentDir, basenameOf(backup.trackingPath))
    // O scratchpad da sessao nao interessa: nao e codigo do projeto.
    if (!absolute.normalize('NFC').startsWith(base.normalize('NFC'))) continue

    const [before, after] = await Promise.all([
      readMaybe(join(backupDir, backup.backupFileName)),
      readMaybe(absolute),
    ])
    if (before === null || after === null) continue

    const built = buildDiff(before, after)
    if (built.added === 0 && built.removed === 0) continue

    const touch = lastTouch.get(absolute)
    files.push({
      path: toRelative(base, absolute),
      added: built.added,
      removed: built.removed,
      touchedAt: touch?.timestamp ?? transcript.updatedAt,
      tool: touch?.tool ?? null,
      source: 'file-history',
      lines: built.lines,
    })
  }
  return files
}

/* ── Fonte 2: git, que enxerga qualquer mudanca em disco ────────────────── */

async function gitChanges(base: string): Promise<ChangedFile[]> {
  let patchText: string
  try {
    const { stdout } = await run(
      'git',
      ['diff', '--no-color', `--unified=${CONTEXT}`, 'HEAD', '--', '.'],
      { cwd: base, maxBuffer: 64 * 1024 * 1024 },
    )
    patchText = stdout
  } catch {
    // Repo sem commit nenhum ainda, ou diretorio fora de repo.
    patchText = ''
  }

  const files: ChangedFile[] = []
  for (const patch of parsePatch(patchText)) {
    const name = (patch.newFileName ?? patch.oldFileName ?? '').replace(/^[ab]\//, '')
    if (!name) continue
    const lines: DiffLine[] = []
    let added = 0
    let removed = 0
    for (const hunk of patch.hunks) {
      lines.push({ kind: 'hunk', text: hunkHeader(hunk), lineNo: null })
      let lineNo = hunk.newStart
      for (const raw of hunk.lines) {
        const marker = raw[0]
        const text = raw.slice(1)
        if (marker === '+') {
          added += 1
          lines.push({ kind: 'add', text, lineNo: lineNo++ })
        } else if (marker === '-') {
          removed += 1
          lines.push({ kind: 'remove', text, lineNo: null })
        } else {
          lines.push({ kind: 'context', text, lineNo: lineNo++ })
        }
      }
    }
    if (added === 0 && removed === 0) continue
    files.push({ path: name, added, removed, touchedAt: null, tool: null, source: 'git', lines })
  }

  files.push(...(await untrackedChanges(base)))
  return files
}

/** Arquivo novo nao aparece no `git diff`, entao entra inteiro como adicao. */
async function untrackedChanges(base: string): Promise<ChangedFile[]> {
  let out: string
  try {
    const { stdout } = await run(
      'git',
      ['ls-files', '--others', '--exclude-standard', '-z', '--', '.'],
      { cwd: base, maxBuffer: 64 * 1024 * 1024 },
    )
    out = stdout
  } catch {
    return []
  }

  const files: ChangedFile[] = []
  for (const relativePath of out.split('\0').filter(Boolean).slice(0, MAX_FILES)) {
    const content = await readMaybe(join(base, relativePath))
    if (content === null) continue
    const built = buildDiff('', content)
    if (built.added === 0) continue
    files.push({
      path: relativePath,
      added: built.added,
      removed: built.removed,
      touchedAt: null,
      tool: null,
      source: 'git',
      lines: built.lines,
    })
  }
  return files
}

/* ── Utilitarios ────────────────────────────────────────────────────────── */

function hunkHeader(hunk: { oldStart: number; oldLines: number; newStart: number; newLines: number }) {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
}

function basenameOf(trackingPath: string): string {
  return trackingPath.split(/[/\\]/).pop() ?? trackingPath
}

/** Caminho relativo estavel, com os dois lados na mesma forma unicode. */
function toRelative(base: string, absolute: string): string {
  return relative(base.normalize('NFC'), absolute.normalize('NFC')).replace(/\\/g, '/')
}

function lastTouchByPath(transcript: TranscriptData) {
  const map = new Map<string, { tool: ChangedFile['tool']; timestamp: number }>()
  for (const touch of transcript.touches) {
    const key = resolve(touch.path)
    const current = map.get(key)
    if (!current || current.timestamp < touch.timestamp) {
      map.set(key, { tool: touch.tool, timestamp: touch.timestamp })
    }
  }
  return map
}

async function readMaybe(path: string): Promise<string | null> {
  try {
    const text = await readFile(path, 'utf8')
    return text.length > MAX_BYTES ? null : text
  } catch {
    return null
  }
}

function buildDiff(before: string, after: string) {
  const patch = structuredPatch('a', 'b', before, after, '', '', { context: CONTEXT })
  const lines: DiffLine[] = []
  let added = 0
  let removed = 0

  for (const hunk of patch.hunks) {
    lines.push({ kind: 'hunk', text: hunkHeader(hunk), lineNo: null })
    let lineNo = hunk.newStart
    for (const raw of hunk.lines) {
      const marker = raw[0]
      const text = raw.slice(1)
      if (marker === '+') {
        added += 1
        lines.push({ kind: 'add', text, lineNo: lineNo++ })
      } else if (marker === '-') {
        removed += 1
        lines.push({ kind: 'remove', text, lineNo: null })
      } else {
        lines.push({ kind: 'context', text, lineNo: lineNo++ })
      }
    }
  }
  return { lines, added, removed }
}
