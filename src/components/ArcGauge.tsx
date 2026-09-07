interface Props {
  /** 0 a 1 da janela de 5h ja decorrida. */
  progress: number
  /** Leitura central, ex "4h 12m". */
  value: string
  caption: string
  accent: string
  live?: boolean
}

const W = 96
const H = 58
const CX = W / 2
const CY = 52
const R = 36
const TICKS = 21

/** Ponto na semicircunferencia, com 0 a esquerda e 1 a direita. */
function polar(t: number, radius: number) {
  const angle = Math.PI * (1 - t)
  return [CX + Math.cos(angle) * radius, CY - Math.sin(angle) * radius] as const
}

function arc(from: number, to: number, radius: number) {
  const [x1, y1] = polar(from, radius)
  const [x2, y2] = polar(to, radius)
  return `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`
}

/**
 * Mostrador da janela de 5h. Um arco com escala graduada le melhor que uma
 * barra reta porque a posicao do ponteiro ja diz "quanto falta" sem numero.
 */
export function ArcGauge({ progress, value, caption, accent, live }: Props) {
  const p = Math.max(0, Math.min(1, progress))
  const [hx, hy] = polar(p, R)

  return (
    <div className={`gauge${live ? ' gauge--live' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        {/* Escala graduada: cada tick e 15 minutos da janela. */}
        {Array.from({ length: TICKS }, (_, i) => {
          const t = i / (TICKS - 1)
          const major = i % 5 === 0
          const inner = R + 4
          const outer = R + (major ? 10 : 7)
          const [x1, y1] = polar(t, inner)
          const [x2, y2] = polar(t, outer)
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={t <= p ? accent : 'currentColor'}
              strokeOpacity={t <= p ? (major ? 0.95 : 0.55) : major ? 0.45 : 0.22}
              strokeWidth={major ? 1.4 : 1}
              className="gauge__tick"
              style={{ animationDelay: `${i * 18}ms` }}
            />
          )
        })}

        <path d={arc(0, 1, R)} fill="none" stroke="currentColor" strokeOpacity={0.16} strokeWidth={2} />
        <path
          d={arc(0, Math.max(p, 0.001), R)}
          fill="none"
          stroke={accent}
          strokeWidth={2}
          strokeLinecap="round"
          className="gauge__fill"
        />

        {/* Ponteiro com anel na cor da superficie, para nao sumir no arco. */}
        <circle cx={hx} cy={hy} r={4} fill={accent} stroke="var(--panel)" strokeWidth={2} />
      </svg>

      <div className="gauge__text">
        <span className="gauge__value">{value}</span>
        <span className="gauge__caption">{caption}</span>
      </div>
    </div>
  )
}
