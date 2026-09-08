import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface Hunk {
  /** Posicao na lista de blocos do arquivo. E por ela que a UI pede. */
  index: number
  /** Cabecalho `@@ -a,b +c,d @@`, util para a UI mostrar a faixa. */
  header: string
  /** As linhas do bloco, com o prefixo do diff (' ', '+', '-'). */
  lines: string[]
  added: number
  removed: number
}

export interface FileDiff {
  /** Linhas antes do primeiro `@@`: diff --git, index, ---, +++. */
  preamble: string[]
  hunks: Hunk[]
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 })
  return stdout
}

/**
 * Blocos de um arquivo, do diff que ainda nao foi para o indice.
 *
 * Sem `--no-color` e sem os algoritmos que reagrupam contexto: o patch
 * precisa voltar exatamente como veio, porque e ele que vamos reaplicar.
 */
export async function listHunks(cwd: string, path: string, staged = false): Promise<FileDiff> {
  const saida = await git(cwd, [
    'diff',
    ...(staged ? ['--cached'] : []),
    '--no-color',
    '--no-ext-diff',
    '-U3',
    '--',
    path,
  ])
  return parseDiff(saida)
}

/** Divide a saida do `git diff` de um arquivo em preambulo e blocos. */
export function parseDiff(texto: string): FileDiff {
  const linhas = texto.split('\n')
  const preamble: string[] = []
  const hunks: Hunk[] = []
  let atual: Hunk | null = null

  for (const linha of linhas) {
    if (linha.startsWith('@@')) {
      if (atual) hunks.push(atual)
      atual = {
        index: hunks.length,
        header: linha,
        lines: [],
        added: 0,
        removed: 0,
      }
      continue
    }

    if (atual === null) {
      // Linha vazia final do stdout nao faz parte do preambulo.
      if (linha !== '' || preamble.length > 0) preamble.push(linha)
      continue
    }

    // "\\ No newline at end of file" pertence ao bloco e precisa ir junto,
    // senao o patch reconstruido muda o arquivo mais do que o pedido.
    if (linha.startsWith('+')) atual.added += 1
    else if (linha.startsWith('-')) atual.removed += 1
    else if (linha !== '' && !linha.startsWith(' ') && !linha.startsWith('\\')) {
      // Chegou noutro arquivo ou noutra secao: encerra.
      hunks.push(atual)
      atual = null
      continue
    }
    atual.lines.push(linha)
  }

  if (atual) hunks.push(atual)

  // A ultima linha do stdout costuma ser vazia; ela nao pertence a bloco.
  for (const h of hunks) {
    while (h.lines.length > 0 && h.lines[h.lines.length - 1] === '') h.lines.pop()
  }

  return { preamble: preamble.filter((l) => l !== ''), hunks }
}

/** Remonta um patch valido com um bloco so. */
export function patchDeUmHunk(diff: FileDiff, index: number): string {
  const hunk = diff.hunks[index]
  if (!hunk) throw new Error(`bloco ${index} nao existe neste arquivo`)
  return [...diff.preamble, hunk.header, ...hunk.lines, ''].join('\n')
}

/**
 * Aplica o patch no indice, via arquivo temporario.
 *
 * Passar por arquivo, e nao por stdin, porque o `git apply` reclama de
 * patch truncado quando o pipe fecha no meio, e o erro sai como "corrupt
 * patch" — que manda procurar defeito no lugar errado.
 */
async function aplicaNoIndice(cwd: string, patch: string, reverso: boolean): Promise<void> {
  const pasta = await mkdtemp(join(tmpdir(), 'customcc-patch-'))
  const arquivo = join(pasta, 'bloco.patch')
  try {
    await writeFile(arquivo, patch, 'utf8')
    await git(cwd, ['apply', '--cached', ...(reverso ? ['--reverse'] : []), '--unidiff-zero', arquivo])
  } catch (error) {
    const detalhe = error as { stderr?: string; message?: string }
    const motivo = (detalhe.stderr ?? detalhe.message ?? '').trim().split('\n')[0]
    throw new Error(motivo || 'git recusou aplicar o bloco')
  } finally {
    await rm(pasta, { recursive: true, force: true })
  }
}

/**
 * Move um bloco para o indice, sem levar o resto do arquivo.
 *
 * Cada cabecalho `@@` aponta posicoes no arquivo do indice, e nao no que
 * ja foi aplicado antes. Por isso qualquer bloco pode ir sozinho: os
 * numeros continuam valendo enquanto o indice nao muda.
 */
export async function stageHunk(cwd: string, path: string, index: number): Promise<void> {
  const diff = await listHunks(cwd, path, false)
  if (diff.hunks.length === 0) throw new Error('nada para mover neste arquivo')
  await aplicaNoIndice(cwd, patchDeUmHunk(diff, index), false)
}

/** Tira do indice um bloco que ja estava staged. */
export async function unstageHunk(cwd: string, path: string, index: number): Promise<void> {
  const diff = await listHunks(cwd, path, true)
  if (diff.hunks.length === 0) throw new Error('nada staged neste arquivo')
  await aplicaNoIndice(cwd, patchDeUmHunk(diff, index), true)
}
