import type { ReactNode } from 'react'

/**
 * Realce de codigo e markdown para o leitor de arquivos.
 *
 * Escrito a mao, sem biblioteca, de proposito: um highlighter de verdade
 * (highlight.js, shiki) custa entre 300KB e um worker, e aqui o trabalho e
 * ler um .md ou conferir uma funcao — nao editar. O que este faz e o que
 * resolve 90% da leitura: comentario, texto entre aspas, numero e palavra
 * reservada. O resto fica na cor normal, que e melhor do que colorir errado.
 */

/** Palavras reservadas das linguagens que aparecem neste projeto. */
const PALAVRAS = new Set(
  (
    'const let var function return if else for while do break continue new class extends ' +
    'import export from default async await try catch finally throw typeof instanceof ' +
    'interface type enum public private protected readonly static implements namespace ' +
    'def lambda pass raise with elif None True False self and or not in is import as ' +
    'fn let mut impl struct pub use match trait where package func go defer chan select ' +
    'end then fi esac echo local export unset source nil true false null undefined this super void'
  ).split(' '),
)

type Tipo = 'comentario' | 'texto' | 'numero' | 'palavra' | 'normal'

/**
 * Um unico regex com alternativas nomeadas pela ordem dos grupos. A ordem
 * e o que faz o realce nao se atrapalhar: comentario primeiro, senao uma
 * aspas dentro de comentario abriria uma string que nunca fecha; texto
 * antes de palavra, senao `const` dentro de uma string ficaria colorido.
 */
const PADRAO =
  /(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.a-fA-Fx]*\b)|([A-Za-z_$][\w$]*)/g

function classe(tipo: Tipo): string {
  return tipo === 'normal' ? '' : `tk tk--${tipo}`
}

/** Quebra uma linha em pedacos coloridos. */
export function realcar(linha: string, linguagem: string): ReactNode[] {
  // Texto puro e markdown nao passam por aqui: colorir prosa pelo acaso de
  // uma palavra bater com `for` deixa o texto pior de ler, nao melhor.
  if (linguagem === 'texto' || linguagem === 'md') return [linha]

  const saida: ReactNode[] = []
  let ultimo = 0
  let chave = 0
  PADRAO.lastIndex = 0

  for (let m = PADRAO.exec(linha); m; m = PADRAO.exec(linha)) {
    const [todo, comentario, texto, numero, palavra] = m
    let tipo: Tipo = 'normal'
    if (comentario) tipo = 'comentario'
    else if (texto) tipo = 'texto'
    else if (numero) tipo = 'numero'
    else if (palavra && PALAVRAS.has(palavra)) tipo = 'palavra'

    if (tipo === 'normal') continue
    if (m.index > ultimo) saida.push(linha.slice(ultimo, m.index))
    saida.push(
      <span key={chave++} className={classe(tipo)}>
        {todo}
      </span>,
    )
    ultimo = m.index + todo.length
  }

  if (ultimo < linha.length) saida.push(linha.slice(ultimo))
  return saida.length > 0 ? saida : [linha]
}

/** Trechos em negrito, italico, codigo e link dentro de uma linha de md. */
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*|_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g

function inline(texto: string, chaveBase: string): ReactNode[] {
  const saida: ReactNode[] = []
  let ultimo = 0
  let n = 0
  INLINE.lastIndex = 0

  for (let m = INLINE.exec(texto); m; m = INLINE.exec(texto)) {
    if (m.index > ultimo) saida.push(texto.slice(ultimo, m.index))
    const [todo, codigo, forte, enfase, link] = m
    const chave = `${chaveBase}-${n++}`
    if (codigo) saida.push(<code key={chave}>{todo.slice(1, -1)}</code>)
    else if (forte) saida.push(<strong key={chave}>{todo.slice(2, -2)}</strong>)
    else if (enfase) saida.push(<em key={chave}>{todo.slice(1, -1)}</em>)
    else if (link) {
      const corte = todo.indexOf('](')
      saida.push(
        <span key={chave} className="md__link" title={todo.slice(corte + 2, -1)}>
          {todo.slice(1, corte)}
        </span>,
      )
    }
    ultimo = m.index + todo.length
  }

  if (ultimo < texto.length) saida.push(texto.slice(ultimo))
  return saida
}

/**
 * Markdown suficiente para ler um README: titulo, lista, citacao, regra,
 * bloco de codigo e os marcadores de linha. Tabela fica como texto, que e
 * pior que renderizar mas melhor que renderizar errado.
 *
 * Tudo vira elemento React, nunca HTML injetado: o arquivo vem do disco do
 * Pedro, mas um README clonado de um repositorio qualquer com `<script>`
 * dentro nao pode virar script rodando no painel.
 */
export function Markdown({ texto }: { texto: string }) {
  const linhas = texto.split('\n')
  const blocos: ReactNode[] = []
  let paragrafo: string[] = []

  const fecharParagrafo = () => {
    if (paragrafo.length === 0) return
    const chave = `p-${blocos.length}`
    blocos.push(<p key={chave}>{inline(paragrafo.join(' '), chave)}</p>)
    paragrafo = []
  }

  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i]

    if (linha.startsWith('```')) {
      fecharParagrafo()
      const lingua = linha.slice(3).trim()
      const corpo: string[] = []
      i += 1
      while (i < linhas.length && !linhas[i].startsWith('```')) {
        corpo.push(linhas[i])
        i += 1
      }
      blocos.push(
        <pre key={`c-${blocos.length}`} className="md__code">
          <code>
            {corpo.map((l, n) => (
              <span key={n} className="md__codeline">
                {realcar(l, lingua || 'ts')}
              </span>
            ))}
          </code>
        </pre>,
      )
      continue
    }

    const titulo = /^(#{1,6})\s+(.*)$/.exec(linha)
    if (titulo) {
      fecharParagrafo()
      const nivel = Math.min(titulo[1].length, 6)
      const chave = `h-${blocos.length}`
      blocos.push(
        <div key={chave} className={`md__h md__h--${nivel}`}>
          {inline(titulo[2], chave)}
        </div>,
      )
      continue
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s-*_]*$/.test(linha)) {
      fecharParagrafo()
      blocos.push(<hr key={`hr-${blocos.length}`} />)
      continue
    }

    const item = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(linha)
    if (item) {
      fecharParagrafo()
      const chave = `li-${blocos.length}`
      blocos.push(
        <div key={chave} className="md__li">
          <span className="md__bullet">·</span>
          <span>{inline(item[1], chave)}</span>
        </div>,
      )
      continue
    }

    const citacao = /^\s*>\s?(.*)$/.exec(linha)
    if (citacao) {
      fecharParagrafo()
      const chave = `q-${blocos.length}`
      blocos.push(
        <div key={chave} className="md__quote">
          {inline(citacao[1], chave)}
        </div>,
      )
      continue
    }

    if (linha.trim() === '') fecharParagrafo()
    else paragrafo.push(linha.trim())
  }

  fecharParagrafo()
  return <div className="md">{blocos}</div>
}
