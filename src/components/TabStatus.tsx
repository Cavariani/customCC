import type { Activity, PtyStatus } from '../lib/usePtySocket'

export type EstadoDaAba = 'connecting' | 'exited' | 'error' | Activity | 'done'

/**
 * Em que pe a aba esta, num sinal so.
 *
 * A ordem importa: "terminou e voce ainda nao viu" vale mais que "parado",
 * porque parado tambem e o estado de uma aba que nunca rodou nada.
 */
export function estadoDaAba(
  status: PtyStatus | undefined,
  atividade: Activity | undefined,
  feito: boolean,
): EstadoDaAba {
  if (status !== 'live') return status ?? 'connecting'
  if (atividade === 'working' || atividade === 'waiting') return atividade
  return feito ? 'done' : (atividade ?? 'idle')
}

export const ROTULO_DE_ESTADO: Record<EstadoDaAba, string> = {
  working: 'pensando',
  waiting: 'esperando voce',
  done: 'terminou',
  idle: 'parado',
  connecting: 'conectando',
  exited: 'processo encerrado',
  error: 'sem conexao',
}

const R = 5.2
const VOLTA = 2 * Math.PI * R

/**
 * Anel de 14px no lugar do ponto de 5px que existia antes. O pedido era ver
 * de longe qual aba esta pensando, e um ponto de 5px que muda de cor nao
 * resolve isso numa barra com seis abas.
 *
 * Trabalhando e um arco girando; o resto e estatico de proposito, senao
 * tres animacoes diferentes competem pela mesma atencao. A cor vem sempre
 * de token do tema: `--red` e o acento (laranja, no tema claude).
 */
export function TabStatus({ estado }: { estado: EstadoDaAba }) {
  return (
    <span
      className={`tabring tabring--${estado}`}
      title={ROTULO_DE_ESTADO[estado]}
      aria-label={ROTULO_DE_ESTADO[estado]}
      role="img"
    >
      <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
        <circle className="tabring__trilho" cx="7" cy="7" r={R} />
        {estado === 'working' ? (
          <circle
            className="tabring__arco"
            cx="7"
            cy="7"
            r={R}
            // Um quarto de volta desenhado, o resto vazio: com o giro, le
            // como carregando sem precisar de fim nem de porcentagem.
            strokeDasharray={`${VOLTA * 0.28} ${VOLTA}`}
          />
        ) : (
          <circle className="tabring__miolo" cx="7" cy="7" r={estado === 'idle' ? 1.8 : 2.9} />
        )}
      </svg>
    </span>
  )
}
