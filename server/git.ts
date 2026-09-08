import { execFile } from 'node:child_process'
import { access, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

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
  /** Repo iniciado e ainda sem nenhum commit: HEAD aponta para o vazio. */
  unborn: boolean
  /** Operacao pela metade, quando ha uma. */
  operation: GitOperation | null
  /**
   * O diretorio tem .git mas o git recusa ler. Sem este campo o caso caia
   * no mesmo `repo: false` de uma pasta comum, e um repo quebrado passava
   * por pasta sem versionamento — silencioso do jeito errado.
   */
  broken: string | null
  ahead: number
  behind: number
  files: GitFile[]
  /** Verdadeiro quando a lista foi cortada por tamanho. */
  truncated: boolean
}

const VAZIO: GitState = {
  repo: false,
  branch: '',
  detached: false,
  unborn: false,
  operation: null,
  broken: null,
  ahead: 0,
  behind: 0,
  files: [],
  truncated: false,
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

/**
 * Variante que devolve null em vez de lancar. Em repo recem-criado ou com
 * HEAD destacado varios comandos falham por serem inaplicaveis, e nao por
 * erro: sem isso a leitura inteira virava um 500 com stack do git na tela.
 */
async function gitOpcional(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await git(cwd, args)).trim()
  } catch {
    return null
  }
}

/** Mensagem do git sem o "fatal:" e sem quebra de linha. */
function motivoDoGit(error: unknown): string {
  const detail = error as { stderr?: string; message?: string }
  const texto = (detail.stderr ?? detail.message ?? '').trim()
  const primeira = texto.split('\n')[0] ?? ''
  return primeira.replace(/^fatal:\s*/, '') || 'git recusou ler o diretorio'
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await access(caminho)
    return true
  } catch {
    return false
  }
}

/** Qual operacao ficou pela metade, olhando as marcas no diretorio do git. */
async function operacaoEmCurso(cwd: string, gitDir: string): Promise<GitOperation | null> {
  const raiz = isAbsolute(gitDir) ? gitDir : join(cwd, gitDir)
  const marcas: [GitOperation, string][] = [
    ['rebase', 'rebase-merge'],
    ['rebase', 'rebase-apply'],
    ['merge', 'MERGE_HEAD'],
    ['cherry-pick', 'CHERRY_PICK_HEAD'],
    ['revert', 'REVERT_HEAD'],
    ['bisect', 'BISECT_LOG'],
  ]
  for (const [operacao, marca] of marcas) {
    if (await existe(join(raiz, marca))) return operacao
  }
  return null
}

/**
 * Codigos XY de entrada nao resolvida do porcelain. Um arquivo em conflito
 * nao pode aparecer como "modificado e staged": era um convite a commitar o
 * arquivo com os marcadores <<<<<<< dentro.
 */
function emConflito(x: string, y: string): boolean {
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')
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
  } catch (error) {
    // Uma pasta comum e um repo corrompido dao a mesma mensagem do git. O
    // que separa os dois e a existencia do .git: se ele esta ali e o git
    // ainda assim recusa, o repo esta quebrado, e dizer "sem versionamento"
    // seria mentira.
    const temGitDir = await existe(join(cwd, '.git'))
    if (!temGitDir) return { ...VAZIO }
    return { ...VAZIO, broken: motivoDoGit(error) }
  }

  // HEAD tem tres estados, e so um deles e um nome de ramo:
  //  - ramo normal: symbolic-ref devolve o nome;
  //  - destacado: symbolic-ref falha, sobra o hash curto;
  //  - recem-criado: HEAD aponta para um ramo que ainda nao tem commit, e
  //    o `rev-parse --abbrev-ref HEAD` de antes lancava "ambiguous argument
  //    'HEAD'" e devolvia 500 com a stack do git para a UI.
  const nomeDoRamo = await gitOpcional(cwd, ['symbolic-ref', '--short', 'HEAD'])
  const temCommit = (await gitOpcional(cwd, ['rev-parse', '--verify', 'HEAD'])) !== null
  const detached = nomeDoRamo === null
  const unborn = !temCommit
  const branch = nomeDoRamo ?? (await gitOpcional(cwd, ['rev-parse', '--short', 'HEAD'])) ?? 'HEAD'

  const gitDir = (await gitOpcional(cwd, ['rev-parse', '--git-dir'])) ?? '.git'
  const operation = await operacaoEmCurso(cwd, gitDir)

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

  // Em repo sem commit o `diff --cached` pode recusar: a falta de estatistica
  // nao vale derrubar a leitura inteira.
  const [unstagedStats, stagedStats] = await Promise.all([
    numstat(cwd, false).catch(() => new Map<string, { added: number; removed: number }>()),
    numstat(cwd, true).catch(() => new Map<string, { added: number; removed: number }>()),
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
  const root = ((await gitOpcional(cwd, ['rev-parse', '--show-toplevel'])) ?? cwd).normalize('NFC')
  // realpath, e nao resolve: o git ja devolve a raiz com os symlinks
  // resolvidos, e comparar /tmp com /private/tmp produzia caminhos como
  // "../../private/tmp/projeto/a.txt" no lugar de "a.txt".
  const base = (await realpath(cwd).catch(() => resolve(cwd))).normalize('NFC')
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

    // Conflito nunca conta como staged: o `git add` ate aceitaria, mas isso
    // marcaria o arquivo como resolvido com os marcadores ainda dentro.
    const conflito = emConflito(x, y)
    const isStaged = !conflito && x !== ' ' && x !== '?'
    const stats = (isStaged ? stagedStats.get(repoPath) : unstagedStats.get(repoPath)) ?? {
      added: 0,
      removed: 0,
    }
    const status = conflito ? 'conflicted' : statusFromCode(x === ' ' || x === '?' ? y : x)
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
  return {
    repo: true,
    branch,
    detached,
    unborn,
    operation,
    broken: null,
    ahead,
    behind,
    files: files.slice(0, MAX_FILES),
    truncated,
  }
}
