import type { Periodo } from '../types'

interface Props {
  periods: Periodo[]
  /** Quantas horas a faixa cobre. */
  horas?: number
  now: number
}

/**
 * Quem esteve ativo, ao longo do dia, numa faixa so.
 *
 * O estado ja registrava isso para atribuir tokens a conta certa, e nada
 * disso aparecia na tela. A identidade da conta vem do numeral escrito
 * dentro do bloco, e nao de uma cor por conta: o painel usa cor para
 * estado, e um codigo de tres cores por identidade brigaria com isso.
 */
export function AccountTimeline({ periods, horas = 12, now }: Props) {
  if (periods.length === 0) return null

  const inicio = now - horas * 60 * 60 * 1000
  const span = now - inicio

  const blocos = periods
    .map((p) => {
      const de = Math.max(p.from, inicio)
      const ate = p.to === null ? now : Math.min(p.to, now)
      return { id: p.accountId, de, ate, atual: p.to === null }
    })
    // Periodo de duracao zero acontece quando duas trocas caem no mesmo
    // milissegundo; desenhar isso vira um risco invisivel que so suja a faixa.
    .filter((b) => b.ate > b.de)

  // Marcas de hora cheia: dao escala sem precisar de eixo escrito.
  const marcas: number[] = []
  const primeira = new Date(inicio)
  primeira.setMinutes(0, 0, 0)
  for (let t = primeira.getTime(); t <= now; t += 60 * 60 * 1000) {
    if (t > inicio) marcas.push(((t - inicio) / span) * 100)
  }

  return (
    <div className="linha" title={`ultimas ${horas} horas`}>
      {marcas.map((esquerda, i) => (
        <span key={i} className="linha__marca" style={{ left: `${esquerda}%` }} aria-hidden="true" />
      ))}

      {blocos.map((b, i) => {
        const largura = ((b.ate - b.de) / span) * 100
        return (
          <span
            key={i}
            className={`linha__bloco${b.atual ? ' is-atual' : ''}`}
            style={{ left: `${((b.de - inicio) / span) * 100}%`, width: `${largura}%` }}
            title={`conta ${b.id} · ${relogio(b.de)} → ${b.atual ? 'agora' : relogio(b.ate)}`}
          >
            {/* O numeral so entra quando cabe: meio digito cortado engana
                mais do que a ausencia dele. */}
            {largura > 4 && <span className="linha__n">{b.id}</span>}
          </span>
        )
      })}
    </div>
  )
}

function relogio(at: number): string {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
