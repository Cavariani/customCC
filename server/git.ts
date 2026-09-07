import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

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
  /** Verdadeiro quando a lista foi cortada por tamanho. */
  truncated: boolean
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

/** Mapeia o codigo XY do porcelain para algo que a UI entende. */
function statusFromCode(code: string): GitFileStatus {
  if (code === '?') return 'untracked'
  if (code === 'A') return 'added'
  if (code === 'D') return 'deleted'
  if (code === 'R') return 'renamed'
  return 'modified'
}

/** `git diff --numstat` como mapa caminho -> linhas somadas e removidas. */
async function numstat(cwd: string, cached: boolean) {
  // O pathspec "." limita ao diretorio do projeto: sem ele, um repo cuja
  // raiz e a home devolve a maquina inteira.
  const out = await git(cwd, ['diff', ...(cached ? ['--cached'] : []), '--numstat', '--', '.'])
  const map = new Map<string, { added: number; removed: number }>()
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [added, removed, ...rest] = line.split('\t')
    const path = rest.join('\t')
    // Arquivos binarios vem com "-" no lugar do numero.
    map.set(path, {
      added: added === '-' ? 0 : Number(added),
      removed: removed === '-' ? 0 : Number(removed),
    })
  }
  return map
}

/** Teto de arquivos devolvidos: o painel nao serve para listar milhares. */
const MAX_FILES = 250

async function countLines(path: string): Promise<number> {
  try {
    const text = await readFile(path, 'utf8')
    return text.length === 0 ? 0 : text.split('\n').length
  } catch {
    return 0
  }
}

export async function readGitState(cwd: string): Promise<GitState> {
  try {
    await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    return { repo: false, branch: '', ahead: 0, behind: 0, files: [], truncated: false }
  }

  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()

  let ahead = 0
  let behind = 0
  try {
    // Falha de proposito quando o branch nao tem upstream: nao e erro.
    const counts = await git(cwd, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])
    const [b, a] = counts.trim().split(/\s+/).map(Number)
    behind = b || 0
    ahead = a || 0
  } catch {
    /* sem upstream configurado */
  }

  const [unstagedStats, stagedStats] = await Promise.all([
    numstat(cwd, false),
    numstat(cwd, true),
  ])

  // -z separa por NUL, o unico jeito seguro com nomes contendo espaco ou
  // acento. Sem -uall de proposito: em repo grande ele lista cada arquivo
  // dentro de cada pasta nova, e a saida explode.
  // Com o pathspec limitando ao projeto, -uall volta a ser seguro e lista
  // arquivo por arquivo em vez de colapsar a pasta nova inteira numa linha.
  const porcelain = await git(cwd, ['status', '--porcelain=v1', '-z', '-uall', '--', '.'])
  // O porcelain devolve caminhos relativos a raiz do repo; a UI quer os
  // caminhos relativos ao projeto aberto na aba.
  // macOS grava os nomes em NFD e o git devolve NFC: sem normalizar os dois
  // lados, "Programacao" com til nao casa consigo mesma e o relative erra.
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim().normalize('NFC')
  const base = resolve(cwd).normalize('NFC')
  const entries = porcelain.split('\0').filter(Boolean)
  const files: GitFile[] = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const x = entry[0]
    const y = entry[1]
    const repoPath = entry.slice(3)
    const absolute = join(root, repoPath).normalize('NFC')
    let path = relative(base, absolute) || repoPath
    // Rename vem como dois registros: destino, depois origem.
    if (x === 'R') i += 1

    const isStaged = x !== ' ' && x !== '?'
    const stats = (isStaged ? stagedStats.get(repoPath) : unstagedStats.get(repoPath)) ?? {
      added: 0,
      removed: 0,
    }
    const status = statusFromCode(x === ' ' || x === '?' ? y : x)
    // Arquivo novo nao aparece no numstat, entao contamos o proprio conteudo.
    if (status === 'untracked' && stats.added === 0) {
      stats.added = await countLines(join(cwd, path))
    }

    files.push({
      path,
      status,
      staged: isStaged,
      added: stats.added,
      removed: stats.removed,
    })
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  const truncated = files.length > MAX_FILES
  return { repo: true, branch, ahead, behind, files: files.slice(0, MAX_FILES), truncated }
}
