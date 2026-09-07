import { squish } from './limits.js'

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
 * Trabalhando nao e mais reconhecido por frase. Medido no binario 2.1.263,
 * o rodape nao escreve "esc to interrupt": ele mostra "Pollinating…",
 * "Thinking…" e afins, que mudam entre versoes e nao dao para listar.
 *
 * O que e estavel e o fluxo: com a sessao parada, o pty nao emitiu um unico
 * pacote em 5s de medicao; trabalhando, emitiu 21 no mesmo intervalo, com
 * pausa maxima de 2.3s entre eles. Entao "esta escrevendo na tela" e o
 * sinal, e o silencio marca o fim.
 */
export const SILENCIO_MS = 3500

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
/**
 * Estado a partir do que esta na tela e de quanto tempo faz que o pty
 * escreveu algo. Esperando vence trabalhando: o pedido de permissao aparece
 * com a tarefa ainda em curso, e quem precisa agir e o usuario.
 */
export function detectActivity(tail: string, msDesdeODadoAnterior: number): Activity {
  const apertado = squish(tail).toLowerCase()
  if (WAITING.some((frase) => apertado.includes(frase))) return 'waiting'
  return msDesdeODadoAnterior < SILENCIO_MS ? 'working' : 'idle'
}
