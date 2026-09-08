import { useWorkspace } from '../lib/workspace'
import { useNow } from '../lib/useNow'
import { msUntilReset } from '../lib/format'
import { useScramble } from '../lib/useScramble'

/** Quanto falta, em h:mm:ss, igual ao contador do painel de contas. */
function regressivo(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`
}

/** Ultimo trecho do caminho: o nome que a pessoa reconhece. */
function nomeDoProjeto(cwd: string | undefined): string {
  if (!cwd) return '--'
  const partes = cwd.replace(/[/\\]+$/, '').split(/[/\\]/)
  return partes[partes.length - 1] || cwd
}

/**
 * A barra em duas zonas que dividem a largura ao meio: onde voce esta e
 * qual conta.
 *
 * A versao anterior repetia quase tudo o que o painel ja mostra — o ritmo e
 * a projecao eram identicos ao "ritmo · projecao", o reset ao "reseta em" —
 * e ainda abria um espacador no meio que nao separava nada. Aqui as zonas
 * esticam, entao nao sobra vao, e ficou so o que continua valendo com o
 * painel recolhido no cmd+B: onde, qual conta, quanto dela resta.
 */
export function StatusBar({ animations }: { animations: boolean }) {
  const { accounts, activeAccountId, git, changes, activeTab } = useWorkspace()
  const now = useNow()
  const active = accounts.find((a) => a.id === activeAccountId)
  const resta = active ? msUntilReset(active, now) : null
  const cinco = active?.quota?.cincoHoras ?? null

  const label = useScramble(active ? `${active.id} ${active.label}` : '', {
    enabled: animations,
    skipFirst: true,
  })

  return (
    <footer className="status">
      <div className="status__zona status__zona--local">
        <span className="status__proj">{nomeDoProjeto(activeTab?.cwd)}</span>
        {git?.repo && (
          <>
            <span className="status__rot">⎇</span>
            <span className="status__ramo">{git.branch}</span>
          </>
        )}
        {changes && changes.files.length > 0 && (
          <>
            <b className="status__mais">+{changes.totals.added}</b>
            <b className="status__menos">−{changes.totals.removed}</b>
          </>
        )}
      </div>

      {/* A zona da conta tem fundo proprio: e o que faz a conta ativa se ler
          de longe sem precisar de cor no texto. */}
      <div className="status__zona status__zona--conta">
        {active && (
          <>
            <b className="status__conta">{label}</b>
            {/* A cota so aparece quando ha leitura do statusline para esta
                conta; sem ela, a barra nao inventa um numero. */}
            {cinco && (
              <>
                <span className="status__mini" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, cinco.usadoPct)}%` }} />
                </span>
                <b className="status__pct">{Math.round(cinco.usadoPct)}%</b>
              </>
            )}
            {resta !== null && (
              <>
                <span className="status__rot">reseta</span>
                <b className="status__reset">{regressivo(resta)}</b>
              </>
            )}
          </>
        )}
        {/* O atalho fica na ponta da propria zona: uma terceira zona so
            para ele abria de novo o vao que essa barra veio fechar. */}
        <span className="status__kbd">cmd+K</span>
      </div>
    </footer>
  )
}
