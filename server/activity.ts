import { squish, stripAnsi } from './limits.js'

export type Activity = 'working' | 'waiting' | 'idle'

/**
 * Em que pe esta a sessao, lido do que o Claude Code desenha na tela. As
 * frases sairam do proprio binario (claude 2.1.263), nao de suposicao:
 *
 *   trabalhando  "esc to interrupt" no rodape enquanto a tarefa roda
 *   esperando    "Do you want to proceed?" e as variantes de permissao
 *
 * Serve para o Pedro saber, com tres abas abertas, qual delas parou
 * pedindo aprovacao e qual ja terminou.
 */
/**
 * A TUI desenha o marcador dentro do rodape de progresso, sempre precedido
 * de parentese ou do separador: "(12s · 4.2k tokens · esc to interrupt)".
 * Exigir isso evita que uma resposta do proprio Claude falando sobre a
 * frase deixe a aba marcada como trabalhando para sempre.
 */
const WORKING = /[(·]\s*esc to interrupt/i

/**
 * Frases sem espaco, para casar tanto com a linha escrita normalmente
 * quanto com a que a TUI posiciona caractere a caractere.
 */
const WAITING = [
  'Do you want to proceed?',
  'Do you want to continue?',
  'No, and tell Claude what to do differently',
  'Claude needs your permission',
  'Claude Code needs your input',
  'Claude Code needs your approval',
  'Do you want to allow this connection?',
  'Is this a project you created or one you trust?',
].map((frase) => frase.replace(/\s+/g, '').toLowerCase())

/**
 * A TUI repinta a tela inteira a cada quadro, entao a cauda recente ja
 * descreve o estado atual: se o marcador nao esta mais la, aquele estado
 * acabou.
 */
export function detectActivity(tail: string): Activity {
  const clean = stripAnsi(tail)
  const apertado = squish(tail).toLowerCase()

  // Esperando vence trabalhando: o prompt de permissao aparece com a
  // tarefa ainda em andamento, e quem precisa agir e o usuario.
  if (WAITING.some((frase) => apertado.includes(frase))) return 'waiting'
  if (WORKING.test(clean) || apertado.includes('esctointerrupt')) return 'working'
  return 'idle'
}
