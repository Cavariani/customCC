import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
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
 * Teto de tempo para um diff, e para a soma de todos eles num pedido.
 *
 * O tamanho do arquivo nao previne nada: o Myers do pacote `diff` custa
 * O(N x D), onde D e a quantidade de diferencas, e nao O(N). Medido nesta
 * maquina, um devDiary.md de 355 KB — pequeno pelo criterio de MAX_BYTES —
 * levava 4,7s num unico structuredPatch, e o /api/changes inteiro passava de
 * 18s. Como o painel repete esse pedido a cada 4s e o servidor e uma thread
 * so, o event loop nunca voltava: as teclas digitadas no terminal ficavam na
 * fila atras do diff e chegavam todas de uma vez quando ele terminava.
 *
 * O `diff` aceita `timeout` e devolve undefined quando desiste, entao o
 * corte e limpo — nao e matar no meio.
 */
const DIFF_TIMEOUT_MS = 250
const DIFF_BUDGET_MS = 1500

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
  // Uma leitura so da sessao ativa: antes o findActiveSession rodava duas
  // vezes por pedido, aqui e de novo dentro do historyChanges.
  const session = await findActiveSession(base)
  const fromHistory = await historyChanges(base, session)

  const byPath = new Map<string, ChangedFile>(fromHistory.files.map((f) => [f.path, f]))

  // O git preenche o que o file-history nao viu: tudo que foi escrito por
  // shell, script ou pela mao do proprio Pedro.
  for (const file of await gitChanges(base)) {
    if (!byPath.has(file.path)) byPath.set(file.path, file)
  }

  // Arquivo cujo diff foi caro demais: o git costuma cobrir, porque o diff
  // dele e nativo. Quando nem o git tem (arquivo novo, ou fora do repo), o
  // painel diz isso em vez de omitir o arquivo — sumir com ele daria a
  // entender que nada mudou ali, que e justamente o contrario.
  for (const relativo of fromHistory.adiados) {
    if (byPath.has(relativo)) continue
    byPath.set(relativo, {
      path: relativo,
      added: 0,
      removed: 0,
      touchedAt: null,
      tool: null,
      source: 'file-history',
      lines: [{ kind: 'hunk', text: 'diff grande demais para calcular aqui', lineNo: null }],
    })
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

/**
 * Diffs ja calculados, guardados pelo conteudo dos dois lados. O painel
 * repete o mesmo pedido a cada 4s e, entre um e outro, quase nada mudou:
 * sem isto o servidor recalculava do zero o diff do projeto inteiro, para
 * chegar exatamente no mesmo resultado.
 *
 * A chave e o digest dos dois textos, e nao o mtime: o backup e o arquivo
 * podem ser reescritos com o mesmo conteudo, e ai o diff nao mudou.
 */
const cacheDeDiff = new Map<string, { chave: string; built: ReturnType<typeof buildDiff> }>()
/** Teto do cache: um arquivo por entrada, e o projeto nao tem mais que isso. */
const CACHE_MAX = 400

function digest(a: string, b: string): string {
  return createHash('sha1').update(a).update('\0').update(b).digest('hex')
}

interface HistoryResult {
  files: ChangedFile[]
  /** Arquivos cujo diff estourou o tempo; o git tenta cobrir depois. */
  adiados: string[]
}

async function historyChanges(
  base: string,
  session: Awaited<ReturnType<typeof findActiveSession>>,
): Promise<HistoryResult> {
  if (!session) return { files: [], adiados: [] }

  const transcript = await readTranscript(session.file, session.sessionId)
  if (!transcript) return { files: [], adiados: [] }

  const backupDir = join(FILE_HISTORY_DIR, session.sessionId)
  const lastTouch = lastTouchByPath(transcript)
  const files: ChangedFile[] = []
  const adiados: string[] = []
  // Orcamento do pedido inteiro: um diff barato por arquivo ainda soma
  // dezenas de segundos quando ha cem arquivos mexidos.
  const fimDoOrcamento = Date.now() + DIFF_BUDGET_MS

  for (const backup of transcript.backups.values()) {
    const absolute = resolve(backup.realParentDir, basenameOf(backup.trackingPath))
    // O scratchpad da sessao nao interessa: nao e codigo do projeto.
    if (!absolute.normalize('NFC').startsWith(base.normalize('NFC'))) continue

    const [before, after] = await Promise.all([
      readMaybe(join(backupDir, backup.backupFileName)),
      readMaybe(absolute),
    ])
    if (before === null || after === null) continue

    const relativo = toRelative(base, absolute)
    const chave = digest(before, after)
    const guardado = cacheDeDiff.get(absolute)
    let built: ReturnType<typeof buildDiff>

    if (guardado && guardado.chave === chave) {
      built = guardado.built
    } else {
      // Sem orcamento sobrando o arquivo fica para o proximo pedido, em vez
      // de segurar a thread que tambem carrega o terminal.
      const sobra = fimDoOrcamento - Date.now()
      if (sobra <= 0) {
        adiados.push(relativo)
        continue
      }
      built = buildDiff(before, after, Math.min(DIFF_TIMEOUT_MS, sobra))
      if (cacheDeDiff.size >= CACHE_MAX) cacheDeDiff.clear()
      cacheDeDiff.set(absolute, { chave, built })
    }

    if (built === null) {
      adiados.push(relativo)
      continue
    }
    if (built.added === 0 && built.removed === 0) continue

    const touch = lastTouch.get(absolute)
    files.push({
      path: relativo,
      added: built.added,
      removed: built.removed,
      touchedAt: touch?.timestamp ?? transcript.updatedAt,
      tool: touch?.tool ?? null,
      source: 'file-history',
      lines: built.lines,
    })
  }
  return { files, adiados }
}

/* ── Fonte 2: git, que enxerga qualquer mudanca em disco ────────────────── */

async function gitChanges(base: string): Promise<ChangedFile[]> {
  // Perguntar antes se ha repo separa "nao ha o que diffar" de "o git
  // falhou". Sem essa pergunta, toda falha vira lista vazia e o painel
  // mente dizendo que nada mudou.
  try {
    await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: base })
  } catch {
    return []
  }

  let patchText: string
  try {
    const { stdout } = await run(
      'git',
      ['diff', '--no-color', `--unified=${CONTEXT}`, 'HEAD', '--', '.'],
      { cwd: base, maxBuffer: 64 * 1024 * 1024 },
    )
    patchText = stdout
  } catch (error) {
    // Repo ainda sem commit nenhum: nao ha HEAD para comparar, e isso e
    // normal. Qualquer outra falha precisa subir, porque engolir aqui fazia
    // o painel dizer "nenhum arquivo alterado" com o projeto cheio de
    // mudanca na tela ao lado.
    if (!isExpectedGitAbsence(error)) throw error
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

/** Falhas que significam "nao ha o que diffar", nao "o git quebrou". */
function isExpectedGitAbsence(error: unknown): boolean {
  const text = String((error as { stderr?: string; message?: string })?.stderr ?? (error as Error)?.message ?? '')
  return (
    /not a git repository/i.test(text) ||
    /could not access 'HEAD'/i.test(text) ||
    /bad revision 'HEAD'/i.test(text) ||
    /unknown revision or path/i.test(text) ||
    /ambiguous argument 'HEAD'/i.test(text) ||
    /does not have any commits yet/i.test(text) ||
    /ENOENT/.test(text)
  )
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
  } catch (error) {
    if (!isExpectedGitAbsence(error)) throw error
    return []
  }

  const files: ChangedFile[] = []
  for (const relativePath of out.split('\0').filter(Boolean).slice(0, MAX_FILES)) {
    const content = await readMaybe(join(base, relativePath))
    if (content === null) continue
    // Arquivo novo entra inteiro como adicao. E o caso barato do Myers,
    // mas o teto fica: um arquivo gigante nao pode travar o pedido.
    const built = buildDiff('', content)
    if (built === null || built.added === 0) continue
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

/**
 * Diff com teto de tempo. Devolve null quando o algoritmo desiste, para o
 * chamador decidir o que dizer — silenciar o arquivo seria mentir dizendo
 * que ele nao mudou.
 */
function buildDiff(before: string, after: string, timeoutMs = DIFF_TIMEOUT_MS) {
  const patch = structuredPatch('a', 'b', before, after, '', '', {
    context: CONTEXT,
    timeout: timeoutMs,
  })
  // `undefined` e como o pacote avisa que estourou o tempo.
  if (!patch) return null
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
