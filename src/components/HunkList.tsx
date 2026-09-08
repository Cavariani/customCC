import { useEffect, useState } from 'react'

interface Hunk {
  index: number
  header: string
  lines: string[]
  added: number
  removed: number
}

interface Props {
  cwd: string
  path: string
  /** Lado do indice: true lista o que ja esta staged, para desfazer. */
  staged: boolean
  /** Chamado depois de mover um bloco, para a lista do painel recarregar. */
  onMoved: () => void
}

/**
 * Os blocos de um arquivo, cada um com o seu proprio botao.
 *
 * O painel so sabia mover arquivo inteiro. Com um arquivo que mistura o
 * conserto e a experiencia ao lado, isso obriga a commitar os dois juntos
 * ou a sair do painel para resolver na mao.
 */
export function HunkList({ cwd, path, staged, onMoved }: Props) {
  const [hunks, setHunks] = useState<Hunk[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const carregar = () => {
    const q = new URLSearchParams({ cwd, path, ...(staged ? { staged: '1' } : {}) })
    fetch(`/api/git/hunks?${q}`)
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error ?? 'nao deu para ler os blocos')
        return d
      })
      .then((d) => {
        setHunks(d.hunks)
        setErro(null)
      })
      .catch((e) => setErro(String(e.message ?? e)))
  }

  useEffect(carregar, [cwd, path, staged])

  const mover = async (index: number) => {
    setOcupado(true)
    try {
      const r = await fetch(`/api/git/${staged ? 'unstage' : 'stage'}-hunk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd, path, index }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'o git recusou o bloco')
      // Recarrega antes de avisar o painel: os indices mudam a cada bloco
      // movido, e uma lista velha faria o proximo clique pegar outro bloco.
      carregar()
      onMoved()
    } catch (e) {
      setErro(String((e as Error).message ?? e))
    } finally {
      setOcupado(false)
    }
  }

  if (erro) return <p className="hunks__erro">{erro}</p>
  if (hunks === null) return <p className="hunks__vazio">lendo os blocos...</p>
  if (hunks.length === 0) return <p className="hunks__vazio">nenhum bloco aqui.</p>

  return (
    <ul className="hunks">
      {hunks.map((h) => (
        <li key={h.index} className="hunk">
          <div className="hunk__topo">
            <span className="hunk__faixa">{h.header.replace(/^@@ | @@.*$/g, '')}</span>
            <span className="hunk__delta">
              <b className="hunk__mais">+{h.added}</b>
              <b className="hunk__menos">-{h.removed}</b>
            </span>
            <button type="button" className="hunk__act" disabled={ocupado} onClick={() => mover(h.index)}>
              {staged ? 'tirar' : 'mover'}
            </button>
          </div>
          <pre className="hunk__corpo">
            {h.lines.map((l, i) => (
              <span key={i} className={`hunk__l hunk__l--${classe(l)}`}>
                {l || ' '}
              </span>
            ))}
          </pre>
        </li>
      ))}
    </ul>
  )
}

function classe(linha: string): string {
  if (linha.startsWith('+')) return 'add'
  if (linha.startsWith('-')) return 'del'
  if (linha.startsWith('\\')) return 'nota'
  return 'ctx'
}
