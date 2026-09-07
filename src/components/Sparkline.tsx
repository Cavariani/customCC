interface Props {
  /** Consumo por fatia da janela de 5h. */
  series: number[]
  /** Fracao da janela decorrida, para marcar o agora. */
  progress: number
  accent: string
  height?: number
}

const W = 100

/**
 * Consumo real ao longo da janela. Serie unica por card, entao a cor carrega
 * estado (ativa ou nao) e nao identidade, e nenhuma legenda e necessaria: o
 * titulo do card ja diz de quem e a linha.
 */
export function Sparkline({ series, progress, accent, height = 30 }: Props) {
  const hasData = series.some((v) => v > 0)

  if (!hasData) {
    return (
      <div className="spark spark--empty" style={{ height }}>
        <span className="spark__baseline" />
        <span className="spark__none">sem consumo nesta janela</span>
      </div>
    )
  }

  const max = Math.max(...series)
  const step = W / Math.max(1, series.length - 1)
  const points = series.map((value, i) => {
    const x = i * step
    const y = height - (value / max) * (height - 4) - 2
    return [x, y] as const
  })

  let line = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1]
    const [x, y] = points[i]
    const mx = (px + x) / 2
    line += ` C ${mx} ${py}, ${mx} ${y}, ${x} ${y}`
  }
  const area = `${line} L ${W} ${height} L 0 ${height} Z`
  const id = `sp${accent.replace(/[^a-z0-9]/gi, '')}`

  // Pico da janela: o unico ponto que ganha rotulo direto.
  const peak = series.indexOf(max)
  const [peakX, peakY] = points[peak]

  return (
    <div className="spark" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.26" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill={`url(#${id})`} className="spark__area" />
        <path
          d={line}
          fill="none"
          stroke={accent}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="spark__line"
        />

        {progress > 0.02 && (
          <line
            x1={progress * W}
            y1={0}
            x2={progress * W}
            y2={height}
            stroke="currentColor"
            strokeOpacity={0.32}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}

        <circle
          cx={peakX}
          cy={peakY}
          r={2.6}
          fill={accent}
          stroke="var(--panel)"
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
          className="spark__peak"
        />
      </svg>
    </div>
  )
}
