import { execFile } from 'node:child_process'
import { resolve, relative, isAbsolute } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Recusa qualquer caminho que escape do diretorio da aba. Sem isso, um
 * caminho como ../../.ssh chegaria ao `git` e ao restore de arquivo.
 */
export function insideCwd(cwd: string, path: string): boolean {
  const base = resolve(cwd).normalize('NFC')
  const target = (isAbsolute(path) ? resolve(path) : resolve(base, path)).normalize('NFC')
  const rel = relative(base, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Teto de caminhos por chamada: acima disso e engano, nao intencao. */
const MAX_PATHS = 500

/**
 * Valida o formato antes de qualquer coisa. Sem a checagem de array, uma
 * string escorregava: `for (const p of "a.txt")` percorre os caracteres, e o
 * comando saia como `git add -- a . t x t`.
 */
function assertPaths(cwd: string, paths: unknown): asserts paths is string[] {
  if (!Array.isArray(paths)) throw new Error('paths precisa ser uma lista de caminhos')
  if (paths.length === 0) throw new Error('nenhum arquivo informado')
  if (paths.length > MAX_PATHS) throw new Error(`caminhos demais numa chamada so: ${paths.length}`)
  for (const path of paths) {
    if (typeof path !== 'string' || !path.trim()) throw new Error('caminho vazio ou nao textual')
    if (path.includes('\0')) throw new Error('caminho com byte nulo')
    if (!insideCwd(cwd, path)) throw new Error(`caminho fora do projeto: ${path}`)
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 })
    return stdout
  } catch (error) {
    // O `git commit` explica o motivo na saida padrao, nao no stderr. Sem
    // juntar as duas, uma recusa vira "Command failed: git commit -m x" e
    // nao diz nada a quem clicou.
    const detail = error as { stdout?: string; stderr?: string; message?: string }
    const motivo = [detail.stderr, detail.stdout]
      .map((t) => (t ?? '').trim())
      .filter(Boolean)
      .join(' · ')
    throw new Error(motivo || detail.message || 'git falhou')
  }
}

/**
 * Recusa cedo quando o diretorio nao e um repositorio. Sem isso o commit
 * caia no `git diff --cached` fora de repo, que responde com a ajuda do
 * `git diff --no-index` — uma tela de uso de comando no lugar de "aqui nao
 * tem git".
 */
async function assertRepo(cwd: string): Promise<void> {
  try {
    await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd })
  } catch {
    throw new Error('nao e um repositorio git')
  }
}

/**
 * Diz se o caminho esta num conflito ainda nao resolvido. O `ls-files -u`
 * so lista entradas com mais de um estagio no indice, que e exatamente a
 * definicao de nao resolvido.
 */
export async function isConflicted(cwd: string, path: string): Promise<boolean> {
  try {
    const out = await git(cwd, ['ls-files', '--unmerged', '--', path])
    return out.trim().length > 0
  } catch {
    return false
  }
}

export async function stage(cwd: string, paths: string[]): Promise<void> {
  assertPaths(cwd, paths)
  await assertRepo(cwd)
  await git(cwd, ['add', '--', ...paths])
}

export async function unstage(cwd: string, paths: string[]): Promise<void> {
  assertPaths(cwd, paths)
  await assertRepo(cwd)
  await git(cwd, ['restore', '--staged', '--', ...paths])
}

export interface CommitResult {
  hash: string
  subject: string
  files: number
}

/**
 * Commita o que estiver staged. Se nada estiver, sobe tudo que ja e
 * rastreado, que e o `commit -a`: arquivo novo continua exigindo stage
 * explicito, para nao entrar no historico sem alguem ter pedido.
 */
export async function commit(cwd: string, message: string, all: boolean): Promise<CommitResult> {
  const text = message.trim()
  if (!text) throw new Error('mensagem vazia')
  await assertRepo(cwd)

  const staged = (await git(cwd, ['diff', '--cached', '--name-only'])).trim()
  if (!staged && !all) throw new Error('nada staged para commitar')

  // -m separado do texto: nada do que o Pedro escrever vira flag.
  await git(cwd, ['commit', ...(all && !staged ? ['-a'] : []), '-m', text])

  const hash = (await git(cwd, ['rev-parse', '--short', 'HEAD'])).trim()
  const subject = (await git(cwd, ['log', '-1', '--format=%s'])).trim()
  const files = (await git(cwd, ['show', '--stat', '--format=', '--name-only', 'HEAD']))
    .split('\n')
    .filter(Boolean).length

  return { hash, subject, files }
}

/** Desfaz mudancas de um arquivo rastreado, voltando ao HEAD. */
export async function checkoutFile(cwd: string, path: string): Promise<void> {
  assertPaths(cwd, [path])
  await git(cwd, ['checkout', 'HEAD', '--', path])
}

/** Diz se o arquivo e rastreado pelo git, para escolher como reverter. */
export async function isTracked(cwd: string, path: string): Promise<boolean> {
  try {
    const out = await git(cwd, ['ls-files', '--error-unmatch', '--', path])
    return out.trim().length > 0
  } catch {
    return false
  }
}
