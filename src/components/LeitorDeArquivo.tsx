import { useEffect, useState } from 'react'
import { Copy, Eye, EyeOff, X } from 'lucide-react'
import { Markdown, realcar } from '../lib/realce'
import { copiarTexto } from '../lib/areaDeTransferencia'

interface Leitura {
  caminho: string
  texto: string
  bytes: number
  truncado: boolean
  binario: boolean
  linguagem: string
  alteradoEm: number
}

/**
 * O arquivo aberto, por cima do terminal e na largura dele.
 *
 * Nao vai no painel da direita de proposito: codigo em coluna de 280px
 * quebra em toda linha e vira outra coisa. Aqui ele ocupa a area do
 * terminal, que e a unica com largura de leitura — e sai com Esc, sem
 * mexer no que estava rodando por baixo.
 */
export function LeitorDeArquivo({
  cwd,
  caminho,
  onFechar,
}: {
  cwd: string
  caminho: string
  onFechar: () => void
}) {
  const [leitura, setLeitura] = useState<Leitura | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [renderizar, setRenderizar] = useState(true)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    let vivo = true
    setLeitura(null)
    setErro(null)
    const url = `/api/arquivo?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(caminho)}`
    fetch(url)
      .then(async (r) => {
        const dado = await r.json()
        if (!r.ok) throw new Error(dado.error ?? `HTTP ${r.status}`)
        return dado as Leitura
      })
      .then((dado) => vivo && setLeitura(dado))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : String(e)))
    return () => {
      vivo = false
    }
  }, [cwd, caminho])

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onFechar()
      }
    }
    // Captura: o xterm fica por baixo e engoliria o Esc antes daqui.
    window.addEventListener('keydown', aoTeclar, true)
    return () => window.removeEventListener('keydown', aoTeclar, true)
  }, [onFechar])

  const md = leitura?.linguagem === 'md'
  const linhas = leitura && !md ? leitura.texto.split('\n') : []

  return (
    <div className="leitor">
      <header className="leitor__topo">
        <span className="leitor__caminho" title={caminho}>
          {caminho}
        </span>
        {leitura && (
          <span className="leitor__meta">
            {leitura.binario ? 'binario' : `${linhas.length || contarLinhas(leitura.texto)} linhas`}
            {leitura.truncado && ' · cortado'}
          </span>
        )}
        {md && (
          <button
            type="button"
            className="leitor__acao"
            onClick={() => setRenderizar((v) => !v)}
            title={renderizar ? 'ver o markdown cru' : 'ver renderizado'}
          >
            {renderizar ? <EyeOff size={12} strokeWidth={1.9} /> : <Eye size={12} strokeWidth={1.9} />}
            {renderizar ? 'cru' : 'render'}
          </button>
        )}
        <button
          type="button"
          className="leitor__acao"
          disabled={!leitura || leitura.binario}
          onClick={() => {
            if (!leitura) return
            void copiarTexto(leitura.texto).then((ok) => {
              setCopiado(ok)
              window.setTimeout(() => setCopiado(false), 1400)
            })
          }}
        >
          <Copy size={12} strokeWidth={1.9} />
          {copiado ? 'copiado' : 'copiar'}
        </button>
        <button type="button" className="leitor__x" onClick={onFechar} aria-label="Fechar leitor">
          <X size={14} strokeWidth={2.2} />
        </button>
      </header>

      <div className="leitor__corpo">
        {erro && <p className="view__note view__note--erro">{erro}</p>}
        {!leitura && !erro && <p className="view__note">abrindo…</p>}
        {leitura?.binario && (
          <p className="view__note">
            arquivo binario ({Math.round(leitura.bytes / 1024)}K). nada para mostrar como texto.
          </p>
        )}
        {leitura && !leitura.binario && md && renderizar && <Markdown texto={leitura.texto} />}
        {leitura && !leitura.binario && (!md || !renderizar) && (
          <pre className="codigo">
            {linhas.length > 0
              ? linhas.map((linha, i) => (
                  <span key={i} className="codigo__linha">
                    <span className="codigo__n">{i + 1}</span>
                    <span className="codigo__txt">{realcar(linha, leitura.linguagem)}</span>
                  </span>
                ))
              : leitura.texto.split('\n').map((linha, i) => (
                  <span key={i} className="codigo__linha">
                    <span className="codigo__n">{i + 1}</span>
                    <span className="codigo__txt">{linha}</span>
                  </span>
                ))}
          </pre>
        )}
      </div>
    </div>
  )
}

function contarLinhas(texto: string): number {
  return texto.split('\n').length
}
