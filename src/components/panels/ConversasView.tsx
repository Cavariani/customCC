import { useEffect, useState } from 'react'
import { useWorkspace } from '../../lib/workspace'
import { formatAgo } from '../../lib/format'
import { useNow } from '../../lib/useNow'
import type { ProjetoComConversas, ResumoDeSessao } from '../../types'

/** Dia e mes do ultimo uso, ou a hora quando foi hoje. */
function quando(at: number, agora: number): string {
  const d = new Date(at)
  const mesmoDia = new Date(agora).toDateString() === d.toDateString()
  return mesmoDia
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

/**
 * As conversas de cada projeto, como uma barra lateral de chat.
 *
 * O Claude Code no terminal nao tem isso: quem quer voltar a uma conversa
 * precisa lembrar o id e digitar `claude --resume`. O desktop tem a lista,
 * mas nao troca de conta sem deslogar. Aqui os dois vivem juntos, e sem
 * indexar nada por fora: o proprio Claude Code ja guarda um diretorio por
 * projeto em ~/.claude/projects, e o titulo legivel esta dentro do
 * transcript. O que faltava era mostrar.
 */
export function ConversasView() {
  const { openTab } = useWorkspace()
  const agora = useNow(30_000)
  const [projetos, setProjetos] = useState<ProjetoComConversas[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [fechados, setFechados] = useState<Set<string>>(new Set())
  const [busca, setBusca] = useState('')

  useEffect(() => {
    let vivo = true
    fetch('/api/conversas?dias=90')
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error ?? 'nao deu para ler as conversas')
        return d.projetos as ProjetoComConversas[]
      })
      .then((p) => vivo && (setProjetos(p), setErro(null)))
      .catch((e) => vivo && setErro(String(e.message ?? e)))
    return () => {
      vivo = false
    }
  }, [])

  if (erro) return <div className="cv"><p className="gv__aviso">{erro}</p></div>
  if (!projetos) return <div className="cv"><p className="gv__vazio">lendo as conversas...</p></div>

  const termo = busca.trim().toLowerCase()
  const filtrados = termo
    ? projetos
        .map((p) => ({
          ...p,
          conversas: p.conversas.filter(
            (c) =>
              (c.titulo ?? '').toLowerCase().includes(termo) ||
              p.nome.toLowerCase().includes(termo),
          ),
        }))
        .filter((p) => p.conversas.length > 0)
    : projetos

  const total = projetos.reduce((t, p) => t + p.conversas.length, 0)

  return (
    <div className="cv">
      <div className="cv__topo">
        <div className="cv__linha">
          <span className="cv__v">{total}</span>
          <span className="cv__k">
            {total === 1 ? 'conversa guardada' : 'conversas guardadas'}
          </span>
        </div>
        <input
          className="cv__busca"
          value={busca}
          placeholder="filtrar por titulo ou projeto"
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      <div className="cv__lista">
        {filtrados.length === 0 && <p className="gv__vazio">nada encontrado.</p>}

        {filtrados.map((p) => {
          // Durante a busca todo grupo fica aberto: esconder o resultado
          // atras de um grupo fechado e o oposto de filtrar.
          const fechado = !termo && fechados.has(p.cwd)
          return (
            <section key={p.cwd} className="cvp">
              <div className="cvp__cab">
                <button
                  type="button"
                  className="cvp__nome"
                  title={p.cwd}
                  onClick={() =>
                    setFechados((s) => {
                      const n = new Set(s)
                      if (n.has(p.cwd)) n.delete(p.cwd)
                      else n.add(p.cwd)
                      return n
                    })
                  }
                >
                  <span className="cvp__seta">{fechado ? '▸' : '▾'}</span>
                  {p.nome}
                  <span className="cvp__n">{p.conversas.length}</span>
                </button>
                {/* Abre uma aba limpa naquela pasta, sem retomar nada. */}
                <button
                  type="button"
                  className="cvp__novo"
                  title={`nova conversa em ${p.nome}`}
                  onClick={() => openTab(p.cwd)}
                >
                  +
                </button>
              </div>

              {!fechado && (
                <ul className="cvp__lista">
                  {p.conversas.map((c) => (
                    <Conversa key={c.sessionId} c={c} cwd={p.cwd} agora={agora} onAbrir={openTab} />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Conversa({
  c,
  cwd,
  agora,
  onAbrir,
}: {
  c: ResumoDeSessao
  cwd: string
  agora: number
  onAbrir: (cwd?: string, conversa?: { id: string; titulo?: string | null }) => void
}) {
  return (
    <li className="cvc">
      <button
        type="button"
        className="cvc__btn"
        title={`retomar · ${c.mensagens} mensagens · ${formatAgo(agora - c.atualizadaEm)} atras`}
        onClick={() => onAbrir(cwd, { id: c.sessionId, titulo: c.titulo })}
      >
        <span className="cvc__marca" aria-hidden="true">
          ·
        </span>
        <span className="cvc__titulo">
          {c.titulo ?? <span className="cvc__sem">sem titulo</span>}
        </span>
        <span className="cvc__quando">{quando(c.atualizadaEm, agora)}</span>
      </button>
    </li>
  )
}
