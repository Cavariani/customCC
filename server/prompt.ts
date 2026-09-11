import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CLAUDE_HOME } from './transcript.js'

/**
 * Prompt global: um texto que vale para toda sessao de `claude`, de todo
 * projeto.
 *
 * Nao ha API para isso e este servidor nunca fala com a Anthropic. O que
 * existe e o arquivo de memoria do usuario, `~/.claude/CLAUDE.md`, que o
 * Claude Code carrega em toda sessao independente da pasta. Entao e nele
 * que escrevemos.
 *
 * O arquivo pode ja ter conteudo do Pedro, escrito na mao, e perde-lo seria
 * grave. Por isso o texto entra num bloco delimitado: gravar so troca o que
 * esta entre os marcadores e nao encosta no resto. Texto vazio remove o
 * bloco inteiro, em vez de deixar um cabecalho orfao.
 */
const ARQUIVO = join(CLAUDE_HOME, 'CLAUDE.md')

const INICIO = '<!-- customcc:prompt-global -->'
const FIM = '<!-- /customcc:prompt-global -->'

export const CAMINHO_DO_PROMPT = ARQUIVO

/** Teto generoso: e instrucao, nao documento. */
export const LIMITE_DE_TEXTO = 8000

function bloco(texto: string): string {
  return `${INICIO}\n${texto.trim()}\n${FIM}`
}

/** Recorta o bloco do arquivo. Devolve tambem o que sobra em volta. */
function separar(conteudo: string): { dentro: string; fora: string } {
  const i = conteudo.indexOf(INICIO)
  const f = conteudo.indexOf(FIM)
  if (i === -1 || f === -1 || f < i) return { dentro: '', fora: conteudo }
  return {
    dentro: conteudo.slice(i + INICIO.length, f).trim(),
    fora: (conteudo.slice(0, i) + conteudo.slice(f + FIM.length)).trim(),
  }
}

export async function lerPromptGlobal(): Promise<{ texto: string; caminho: string }> {
  const conteudo = await readFile(ARQUIVO, 'utf8').catch(() => '')
  return { texto: separar(conteudo).dentro, caminho: ARQUIVO }
}

export async function gravarPromptGlobal(
  texto: string,
): Promise<{ texto: string; caminho: string }> {
  const limpo = texto.slice(0, LIMITE_DE_TEXTO).trim()
  const conteudo = await readFile(ARQUIVO, 'utf8').catch(() => '')
  const { fora } = separar(conteudo)

  // Sem texto o bloco sai de cena; com texto ele vai para o fim, depois do
  // que o usuario escreveu — instrucao mais recente por ultimo.
  const novo = limpo ? (fora ? `${fora}\n\n${bloco(limpo)}\n` : `${bloco(limpo)}\n`) : fora ? `${fora}\n` : ''

  await mkdir(dirname(ARQUIVO), { recursive: true })
  await writeFile(ARQUIVO, novo, 'utf8')
  return { texto: limpo, caminho: ARQUIVO }
}
