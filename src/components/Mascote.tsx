/**
 * O mascote em pixel art, o mesmo desenho do favicon.
 *
 * Desenhado em SVG, e nao como imagem: assim ele herda a cor do estado —
 * um bicho por sessao, na cor do que aquela sessao esta fazendo.
 */

/** Grade de 16x16. Cada '#' e um pixel aceso. */
const CORPO = [
  '................',
  '................',
  '..############..',
  '..############..',
  '..############..',
  '..##.######.##..',
  '..##.######.##..',
  '################',
  '################',
  '..############..',
  '..############..',
  '...#.#....#.#...',
  '...#.#....#.#...',
  '................',
  '................',
  '................',
]

/** As duas linhas dos pes, que sao o que se move ao caminhar. */
const PES = new Set([11, 12])

interface Faixa {
  x: number
  y: number
  w: number
  pe: boolean
}

/** Cada sequencia horizontal acesa vira um retangulo, e nao um por pixel. */
function faixas(): Faixa[] {
  const out: Faixa[] = []
  CORPO.forEach((linha, y) => {
    let x = 0
    while (x < linha.length) {
      if (linha[x] !== '#') {
        x += 1
        continue
      }
      const inicio = x
      while (x < linha.length && linha[x] === '#') x += 1
      out.push({ x: inicio, y, w: x - inicio, pe: PES.has(y) })
    }
  })
  return out
}

const FAIXAS = faixas()

interface Props {
  /** 'busy' anda, 'idle' fica parado. */
  estado: 'busy' | 'idle'
  /** Deslocamento do passo, para dois mascotes nao andarem em sincronia. */
  atraso?: number
  tamanho?: number
}

export function Mascote({ estado, atraso = 0, tamanho = 34 }: Props) {
  return (
    <svg
      className={`masc masc--${estado}`}
      width={tamanho}
      height={tamanho}
      viewBox="-1 0 18 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ animationDelay: `${atraso}ms` }}
    >
      {/* O corpo balanca e as pernas alternam: o passo e feito de duas
          partes, senao o bicho desliza em vez de caminhar. */}
      <g className="masc__corpo">
        {FAIXAS.filter((f) => !f.pe).map((f, i) => (
          <rect key={i} x={f.x} y={f.y} width={f.w} height={1} />
        ))}
      </g>
      <g className="masc__pe masc__pe--esq">
        {FAIXAS.filter((f) => f.pe && f.x < 8).map((f, i) => (
          <rect key={i} x={f.x} y={f.y} width={f.w} height={1} />
        ))}
      </g>
      <g className="masc__pe masc__pe--dir">
        {FAIXAS.filter((f) => f.pe && f.x >= 8).map((f, i) => (
          <rect key={i} x={f.x} y={f.y} width={f.w} height={1} />
        ))}
      </g>
    </svg>
  )
}
