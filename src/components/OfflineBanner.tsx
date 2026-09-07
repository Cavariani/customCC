import { PlugZap, RefreshCw } from 'lucide-react'
import { useWorkspace } from '../lib/workspace'

/**
 * O servidor local caiu. Antes disso so aparecia um ponto vermelho na aba,
 * e o painel seguia mostrando numeros velhos como se fossem atuais.
 */
export function OfflineBanner() {
  const { online } = useWorkspace()
  if (online) return null

  return (
    <div className="offline" role="alert">
      <PlugZap size={14} strokeWidth={2.1} />
      <div className="offline__text">
        <strong>servidor local fora do ar</strong>
        <span>os numeros na tela sao os ultimos que chegaram</span>
      </div>
      <button type="button" className="offline__retry" onClick={() => location.reload()}>
        <RefreshCw size={12} strokeWidth={2.3} /> tentar de novo
      </button>
    </div>
  )
}
