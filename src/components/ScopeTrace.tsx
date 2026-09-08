interface Props {
  /** Consumo por fatia de 10 minutos da janela de 5h. */
  series: number[]
  /** Fracao da janela decorrida: onde o feixe para. */
  progress: number
  accent: string
  /** Ativa o rastro que se redesenha em loop. */
  live: boolean
}

const W = 340
const H = 96

/**
 * O consumo da janela desenhado como traco de osciloscopio. O eixo x e o
 * tempo, entao a posicao do feixe ja diz quanto da janela passou, e a altura
 * diz onde o gasto se concentrou: um instrumento so, nao dois.
 */
export function ScopeTrace({ series, progress, accent, live }: Props) {
  const max = Math.max(...series, 1)
  const hasData = series.some((v) => v > 0)
  const total = series.reduce((a, b) => a + b, 0)

  const points = series.map((value, i) => {
    const x = (i / Math.max(1, series.length - 1)) * W
    const y = H - (value / max) * (H - 16) - 8
    return [x, y] as const
  })

  let path = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1]
    const [x, y] = points[i]
    const mx = (px + x) / 2
    path += ` C ${mx} ${py}, ${mx} ${y}, ${x} ${y}`
  }

  // A mesma curva fechada ate a base. Sem ela, uma janela de consumo baixo
  // (ou uma conta zerada) vira um fio solto no meio de um vao, que le como
  // painel quebrado; com o preenchimento, o vazio vira uma faixa rasa, que
  // e a leitura certa: consumiu pouco.
  const area = `${path} L ${W} ${H} L 0 ${H} Z`

  const beamX = progress * W

  return (
    <svg
      className={`scope__svg${live ? ' is-live' : ''}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* A chave muda quando chega consumo novo, e so entao o traco se
          redesenha. Antes ele varria em loop, o que virava ruido no canto
          do olho sem dizer nada. */}
      <path
        className="scope__area"
        d={area}
        style={{ fill: accent, opacity: hasData ? 0.16 : 0.07 }}
      />
      <path
        key={`${series.length}:${total}`}
        className="scope__trace"
        d={path}
        style={{ stroke: accent, opacity: hasData ? 1 : 0.4 }}
      />
      {/* Sem circulo no feixe: o viewBox estica em x e y de forma
          diferente, entao o ponto saia como uma elipse deformada. A linha
          vertical ja diz onde a janela esta. */}
      {progress > 0.01 && (
        <line
          className="scope__now"
          x1={beamX}
          y1={0}
          x2={beamX}
          y2={H}
          style={{ stroke: accent }}
        />
      )}
    </svg>
  )
}
