import { useEffect, useState } from 'react'
import { formatTokens } from '../../lib/format'
import type { Historico, ResumoDeSessao } from '../../types'

/** Duracao em h/min, sem segundos: sessao e coisa de minutos para cima. */
function duracao(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min}min`
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`
}

/** Dia e hora do ultimo uso. O ano nunca cabe e raramente importa. */
function quando(at: number): string {
  return new Date(at).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const dinheiro = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(2))

/**
 * Historico de sessoes, de todos os projetos.
 *
 * O painel so sabia do agora: quanto a janela de 5h ja consumiu. Nada dizia
 * onde o mes foi parar. Os dados ja estavam no disco — a linha `cost-state`
 * de cada transcript, que ninguem lia.
 */
export function HistoryView() {
  const [dados, setDados] = useState<Historico | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [dias, setDias] = useState(30)

  useEffect(() => {
    let vivo = true
    fetch(`/api/history?dias=${dias}`)
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error ?? 'nao deu para ler o historico')
        return d as Historico
      })
      .then((d) => vivo && (setDados(d), setErro(null)))
      .catch((e) => vivo && setErro(String(e.message ?? e)))
    return () => {
      vivo = false
    }
  }, [dias])

  if (erro) return <div className="hv"><p className="gv__aviso">{erro}</p></div>
  if (!dados) return <div className="hv"><p className="gv__vazio">lendo o historico...</p></div>
  if (dados.sessoes.length === 0) {
    return <div className="hv"><p className="gv__vazio">nenhuma sessao nos ultimos {dias} dias.</p></div>
  }

  const { totais } = dados
  const maior = Math.max(...dados.sessoes.map((s) => s.custoUSD), 0.01)

  return (
    <div className="hv">
      <div className="hv__topo">
        <div className="hv__linha">
          <span className="hv__v">{dinheiro(totais.custoUSD)}</span>
          {/* "equivalente" nao e enfeite: no plano Pro nada disso e cobrado.
              Sem a palavra, o numero le como fatura. */}
          <span className="hv__k">em uso equivalente</span>
        </div>
        <div className="hv__split">
          <span>
            sessoes <b>{totais.sessoes}</b>
          </span>
          <span>
            tempo <b>{Math.round(totais.duracaoMs / 3600000)}h</b>
          </span>
          {/* Escritas e apagadas em verde e vermelho, como no git e no
              painel de mudancas: o sinal sozinho, sem cor, se perdia no
              meio dos outros numeros da linha. */}
          <span>
            linhas <b className="hv__mais">+{totais.linhasAdicionadas}</b>
            {totais.linhasRemovidas > 0 && (
              <>
                {' '}
                <b className="hv__menos">-{totais.linhasRemovidas}</b>
              </>
            )}
          </span>
        </div>
      </div>

      <div className="hv__periodo">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            className={`hv__aba${dias === d ? ' is-on' : ''}`}
            onClick={() => setDias(d)}
          >
            {d} dias
          </button>
        ))}
      </div>

      <div className="gv__cols">
        <span>sessao</span>
        <span className="gv__cols-r">uso</span>
      </div>

      <div className="hv__lista">
        {dados.sessoes.map((s) => (
          <Sessao key={s.sessionId} s={s} maior={maior} />
        ))}
      </div>

      <div className="destino">
        <h5 className="destino__t">por projeto</h5>
        <div className="destino__kv">
          {dados.projetos.slice(0, 5).map((p) => (
            <Linha key={p.nome} k={p.nome} v={`${dinheiro(p.custoUSD)} · ${p.sessoes}x`} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** O grid de duas colunas do destino pede os filhos soltos, nao aninhados. */
function Linha({ k, v }: { k: string; v: string }) {
  return (
    <>
      <span>{k}</span>
      <b>{v}</b>
    </>
  )
}

function Sessao({ s, maior }: { s: ResumoDeSessao; maior: number }) {
  const peso = (s.custoUSD / maior) * 100
  return (
    <div className="hvs" title={s.cwd}>
      <div className="hvs__linha">
        <span className="hvs__nome">
          {s.titulo ?? <span className="hvs__sem">sem titulo</span>}
        </span>
        <b className="hvs__v">{dinheiro(s.custoUSD)}</b>
      </div>

      {/* Peso da sessao no periodo, no mesmo desenho dos medidores. */}
      <div className="hvs__peso" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.max(0, peso))}%` }} />
      </div>

      <div className="hvs__meta">
        <span className="hvs__proj">{s.projeto}</span>
        <span>{duracao(s.duracaoMs)}</span>
        <span>{formatTokens(s.tokens)}</span>
        <span>{s.modelos[0]?.nome ?? '--'}</span>
        <span className="hvs__quando">{quando(s.atualizadaEm)}</span>
      </div>
    </div>
  )
}
