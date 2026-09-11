import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, File, FileCode, FileText, Folder, RotateCw } from 'lucide-react'
import { useWorkspace } from '../../lib/workspace'

interface Entrada {
  nome: string
  caminho: string
  tipo: 'pasta' | 'arquivo'
  tamanho: number
  alteradoEm: number
}

interface Listagem {
  caminho: string
  entradas: Entrada[]
  truncada: boolean
}

/** Pastas que quase nunca sao o que voce quer ver, e que tem milhares de itens. */
const PESADAS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.venv', '__pycache__'])

const ICONE_DE_CODIGO = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|c|h|cpp|cs|sh|css|html|json|ya?ml|toml)$/i

function Icone({ nome }: { nome: string }) {
  if (/\.(md|markdown|txt)$/i.test(nome)) return <FileText size={12} strokeWidth={1.8} />
  if (ICONE_DE_CODIGO.test(nome)) return <FileCode size={12} strokeWidth={1.8} />
  return <File size={12} strokeWidth={1.8} />
}

/**
 * A pasta da aba ativa, como arvore. O `cwd` manda: trocar de aba troca a
 * raiz, porque e sempre "o que este `claude` esta vendo" — uma arvore
 * apontando para outro lugar que o terminal ao lado seria so confusao.
 */
export function ArquivosView({ onAbrir }: { onAbrir: (caminho: string) => void }) {
  const { activeTab } = useWorkspace()
  const cwd = activeTab?.cwd ?? ''
  const [listagens, setListagens] = useState<Record<string, Listagem>>({})
  const [abertas, setAbertas] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState<string | null>(null)

  const carregar = useCallback(
    async (caminho: string) => {
      if (!cwd) return
      setCarregando(caminho)
      try {
        const url = `/api/arquivos?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(caminho)}`
        const resposta = await fetch(url)
        const dado = await resposta.json()
        if (!resposta.ok) throw new Error(dado.error ?? `HTTP ${resposta.status}`)
        setListagens((prev) => ({ ...prev, [caminho]: dado }))
        setErro(null)
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e))
      } finally {
        setCarregando(null)
      }
    },
    [cwd],
  )

  // Trocou de pasta: a arvore antiga descrevia outro projeto.
  useEffect(() => {
    setListagens({})
    setAbertas(new Set())
    void carregar('')
  }, [cwd, carregar])

  const alternar = (caminho: string) => {
    setAbertas((prev) => {
      const proxima = new Set(prev)
      if (proxima.has(caminho)) proxima.delete(caminho)
      else {
        proxima.add(caminho)
        // Pasta so e lida quando abre: ler a arvore inteira de uma vez
        // custaria minutos num projeto com node_modules.
        if (!listagens[caminho]) void carregar(caminho)
      }
      return proxima
    })
  }

  const linhas = (caminho: string, nivel: number) => {
    const lista = listagens[caminho]
    if (!lista) return null
    return lista.entradas.map((entrada) => {
      const aberta = abertas.has(entrada.caminho)
      return (
        <div key={entrada.caminho}>
          <button
            type="button"
            className={`arv__item${entrada.tipo === 'pasta' ? ' arv__item--pasta' : ''}${
              PESADAS.has(entrada.nome) ? ' arv__item--pesada' : ''
            }`}
            style={{ paddingLeft: 6 + nivel * 11 }}
            title={entrada.caminho}
            onClick={() =>
              entrada.tipo === 'pasta' ? alternar(entrada.caminho) : onAbrir(entrada.caminho)
            }
          >
            {entrada.tipo === 'pasta' ? (
              <>
                {aberta ? (
                  <ChevronDown size={11} strokeWidth={2} />
                ) : (
                  <ChevronRight size={11} strokeWidth={2} />
                )}
                <Folder size={12} strokeWidth={1.8} />
              </>
            ) : (
              <>
                <span className="arv__vazio" />
                <Icone nome={entrada.nome} />
              </>
            )}
            <span className="arv__nome">{entrada.nome}</span>
            {entrada.tipo === 'arquivo' && entrada.tamanho > 0 && (
              <span className="arv__tam">{tamanho(entrada.tamanho)}</span>
            )}
          </button>
          {aberta && linhas(entrada.caminho, nivel + 1)}
        </div>
      )
    })
  }

  if (!cwd) return <p className="view__note">a aba ainda nao sabe em que pasta esta.</p>

  return (
    <div className="view view--flush">
      <div className="arv__topo">
        <span className="arv__raiz" title={cwd}>
          {cwd.split(/[/\\]/).filter(Boolean).pop()}
        </span>
        <button
          type="button"
          className="arv__recarregar"
          aria-label="Recarregar arvore"
          title="recarregar"
          onClick={() => {
            setListagens({})
            setAbertas(new Set())
            void carregar('')
          }}
        >
          <RotateCw size={12} strokeWidth={1.9} />
        </button>
      </div>

      {erro && <p className="view__note view__note--erro">{erro}</p>}
      {!listagens[''] && carregando !== null && <p className="view__note">lendo a pasta…</p>}

      <div className="arv">{linhas('', 0)}</div>

      {listagens['']?.truncada && (
        <p className="view__note">pasta grande demais; a lista veio cortada.</p>
      )}
    </div>
  )
}

function tamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`
  return `${(bytes / 1024 / 1024).toFixed(1)}M`
}
