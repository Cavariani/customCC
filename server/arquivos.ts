import { readdir, readFile, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * Leitura da pasta do projeto para a aba "arquivos".
 *
 * Toda rota daqui recebe dois caminhos: a raiz (o cwd da aba) e um caminho
 * relativo vindo do navegador. O relativo e dado de fora, entao nunca pode
 * ser concatenado sem conferir: `../../.ssh/id_rsa` sairia da raiz e o
 * painel viraria um leitor do disco inteiro. `dentro()` e essa conferencia,
 * feita depois de resolver symlink — sem isso um link dentro do projeto
 * apontando para fora passaria pelo teste de prefixo.
 */

/** Teto de leitura. Acima disso o arquivo volta cortado, dizendo que cortou. */
export const LIMITE_BYTES = 512 * 1024

/** Quantas entradas devolvemos por pasta antes de cortar. */
const LIMITE_ENTRADAS = 2000

export interface EntradaDePasta {
  nome: string
  /** Relativo a raiz, sempre com barra normal, para o front nao ter dois formatos. */
  caminho: string
  tipo: 'pasta' | 'arquivo'
  tamanho: number
  alteradoEm: number
}

export interface Listagem {
  caminho: string
  entradas: EntradaDePasta[]
  truncada: boolean
}

export interface Leitura {
  caminho: string
  texto: string
  bytes: number
  truncado: boolean
  binario: boolean
  linguagem: string
  alteradoEm: number
}

/** Caminho com symlink resolvido; quando nao existe, o proprio. */
function real(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/**
 * O alvo esta sob a raiz? Compara depois de resolver symlink e exige que a
 * fronteira caia num separador: `/projeto-secreto` nao pode passar por
 * estar prefixado por `/projeto`.
 */
export function dentro(raiz: string, alvo: string): boolean {
  const r = real(resolve(raiz))
  const a = real(resolve(alvo))
  if (a === r) return true
  const rel = relative(r, a)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Junta raiz e caminho relativo recusando o que escapa. */
export function resolverDentro(raiz: string, rel: string): string {
  const limpo = (rel ?? '').replace(/^[/\\]+/, '')
  const alvo = resolve(raiz, limpo)
  if (!dentro(raiz, alvo)) throw new Error('caminho fora da pasta do projeto')
  return alvo
}

/** Caminho relativo normalizado com barra normal, que e o que o front usa. */
function relativoLimpo(raiz: string, alvo: string): string {
  return relative(raiz, alvo).split(sep).join('/')
}

export async function listarPasta(raiz: string, rel = ''): Promise<Listagem> {
  const alvo = resolverDentro(raiz, rel)
  const itens = await readdir(alvo, { withFileTypes: true })
  const entradas: EntradaDePasta[] = []

  for (const item of itens.slice(0, LIMITE_ENTRADAS)) {
    const cheio = join(alvo, item.name)
    // Um stat que falha (link quebrado, permissao) nao pode derrubar a
    // listagem inteira: a entrada entra com tamanho zero.
    const info = await stat(cheio).catch(() => null)
    const pasta = info ? info.isDirectory() : item.isDirectory()
    entradas.push({
      nome: item.name,
      caminho: relativoLimpo(raiz, cheio),
      tipo: pasta ? 'pasta' : 'arquivo',
      tamanho: info && !pasta ? info.size : 0,
      alteradoEm: info ? info.mtimeMs : 0,
    })
  }

  // Pastas primeiro, e dentro de cada grupo em ordem alfabetica sem
  // diferenciar maiuscula: e a ordem que o olho espera numa arvore.
  entradas.sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'pasta' ? -1 : 1
    return a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })
  })

  return {
    caminho: relativoLimpo(raiz, alvo),
    entradas,
    truncada: itens.length > LIMITE_ENTRADAS,
  }
}

/** Extensao vira nome de linguagem so para o realce saber o que fazer. */
export function linguagemDe(nome: string): string {
  const ext = (nome.split('.').pop() ?? '').toLowerCase()
  const mapa: Record<string, string> = {
    ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
    js: 'ts', jsx: 'ts', mjs: 'ts', cjs: 'ts',
    json: 'json',
    md: 'md', markdown: 'md',
    css: 'css', scss: 'css',
    html: 'html', htm: 'html', xml: 'html', svg: 'html',
    py: 'py',
    sh: 'sh', bash: 'sh', zsh: 'sh',
    yml: 'yaml', yaml: 'yaml',
    toml: 'toml', ini: 'toml', env: 'toml',
    sql: 'sql',
    go: 'go', rs: 'rs', java: 'java', c: 'c', h: 'c', cpp: 'c', hpp: 'c', cs: 'c',
    rb: 'rb', php: 'php',
  }
  return mapa[ext] ?? 'texto'
}

export async function lerArquivo(raiz: string, rel: string): Promise<Leitura> {
  const alvo = resolverDentro(raiz, rel)
  const info = await stat(alvo)
  if (info.isDirectory()) throw new Error('isso e uma pasta')

  const bruto = await readFile(alvo)
  const cortado = bruto.subarray(0, LIMITE_BYTES)
  // Byte zero no comeco e o sinal barato de binario: nenhum texto util tem
  // NUL, e abrir um .png como texto enche a tela de lixo e trava a aba.
  const binario = cortado.subarray(0, 8192).includes(0)

  return {
    caminho: relativoLimpo(raiz, alvo),
    texto: binario ? '' : cortado.toString('utf8'),
    bytes: info.size,
    truncado: info.size > LIMITE_BYTES,
    binario,
    linguagem: linguagemDe(alvo),
    alteradoEm: info.mtimeMs,
  }
}
