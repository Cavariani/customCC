interface Props {
  /** Consumo por fatia de 10 minutos da janela de 5h. */
  series: number[]
  /** Fracao da janela ja decorrida: separa o passado do que ainda vem. */
  progress: number
  accent: string
  /** Altura fixa; sem ela o instrumento ocupa o espaco livre do card. */
  height?: number
}

/**
 * A janela de 5h inteira num instrumento so. O eixo x e o tempo, entao a
 * fronteira entre barra e vazio ja diz quanto da janela passou, e a altura
 * das barras diz onde o consumo se concentrou. Antes isso eram duas pecas
 * (um arco para o tempo, uma linha para o gasto) contando a mesma coisa.
 */
export function WindowBars({ series, progress, accent, height }: Props) {
  const slots = series.length
  const max = Math.max(...series, 1)
  const nowSlot = Math.min(slots, Math.round(progress * slots))
  const peak = series.indexOf(max)
  const hasData = series.some((v) => v > 0)

  return (
    <div className="bars" style={height ? { height, flex: 'none' } : undefined}>
      {series.map((value, i) => {
        // `future` decide so a sombra do trilho. Quem some e o balde vazio,
        // nao o futuro: com a janela recem-aberta o nowSlot e 0, entao todo
        // balde caia como futuro e o consumo real ficava escondido — a conta
        // mostrava 80k tokens sobre um grafico em branco.
        const future = i >= nowSlot
        const vazio = value === 0
        const ratio = hasData ? value / max : 0
        return (
          <span
            key={i}
            className={`bars__slot${future ? ' is-future' : ''}${vazio ? ' is-empty' : ''}${i === peak && hasData ? ' is-peak' : ''}`}
            style={{ '--h': `${Math.max(ratio * 100, value > 0 ? 8 : 0)}%`, '--d': `${i * 14}ms` } as React.CSSProperties}
          >
            <span className="bars__fill" style={{ background: accent }} />
          </span>
        )
      })}
    </div>
  )
}
