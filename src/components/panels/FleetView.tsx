import { useEffect, useState } from 'react'
import { useNow } from '../../lib/useNow'
import { formatAgo } from '../../lib/format'
import { Mascote } from '../Mascote'
import type { Frota, SessaoViva, TarefaDeFundo } from '../../types'

const ROTULO: Record<SessaoViva['estado'], string> = {
  busy: 'trabalhando',
  idle: 'parada',
}

/**
 * Todas as sessoes do Claude Code vivas nesta maquina.
 *
 * O painel so sabia da aba que ele mesmo abriu: com duas sessoes no mesmo
 * projeto, tratava as duas como uma coisa so. O estado sai de
 * ~/.claude/sessions, onde cada processo mantem o proprio arquivo.
 *
 * Um aviso sobre o que esta tela NAO mostra: subagente lancado pela
 * ferramenta Agent nao deixa estado em disco enquanto trabalha — nem
 * sidechain no transcript, nem worker no roster do daemon. Animar um
 * bicho por subagente seria inventar movimento sem saber se ele esta
 * trabalhando ou travado.
 */
export function FleetView() {
  const [dados, setDados] = useState<Frota | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const agora = useNow(3000)

  useEffect(() => {
    let vivo = true
    const buscar = () =>
      fetch('/api/fleet')
        .then(async (r) => {
          const d = await r.json()
          if (!r.ok) throw new Error(d.error ?? 'nao deu para ler a frota')
          return d as Frota
        })
        .then((d) => vivo && (setDados(d), setErro(null)))
        .catch((e) => vivo && setErro(String(e.message ?? e)))

    buscar()
    const id = window.setInterval(buscar, 3000)
    return () => {
      vivo = false
      window.clearInterval(id)
    }
  }, [])

  if (erro) return <div className="fv"><p className="gv__aviso">{erro}</p></div>
  if (!dados) return <div className="fv"><p className="gv__vazio">procurando sessoes...</p></div>

  const ocupadas = dados.sessoes.filter((s) => s.estado === 'busy').length

  return (
    <div className="fv">
      <div className="fv__topo">
        <div className="fv__linha">
          <span className="fv__v">{dados.sessoes.length}</span>
          <span className="fv__k">
            {dados.sessoes.length === 1 ? 'sessao viva' : 'sessoes vivas'}
          </span>
        </div>
        <div className="fv__split">
          <span>
            trabalhando <b className="fv__on">{ocupadas}</b>
          </span>
          <span>
            paradas <b>{dados.sessoes.length - ocupadas}</b>
          </span>
        </div>
      </div>

      <div className="gv__cols">
        <span>sessao</span>
        <span className="gv__cols-r">estado</span>
      </div>

      <div className="fv__lista">
        {dados.sessoes.length === 0 && (
          <p className="gv__vazio">nenhuma sessao do claude rodando agora.</p>
        )}
        {dados.sessoes.map((s, i) => (
          <Bicho key={s.pid} s={s} atraso={i * 220} agora={agora} />
        ))}
      </div>

      {dados.tarefas.length > 0 && (
        <div className="destino">
          <h5 className="destino__t">tarefas de fundo</h5>
          <div className="destino__kv">
            {dados.tarefas.slice(0, 4).map((t) => (
              <Tarefa key={t.id} t={t} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Tarefa({ t }: { t: TarefaDeFundo }) {
  return (
    <>
      <span>{t.nome}</span>
      <b>{t.estado}</b>
    </>
  )
}

function Bicho({ s, atraso, agora }: { s: SessaoViva; atraso: number; agora: number }) {
  return (
    <div className={`fvs fvs--${s.estado}`} title={s.cwd}>
      <div className="fvs__bicho">
        <Mascote estado={s.estado} atraso={atraso} />
      </div>

      <div className="fvs__dados">
        <div className="fvs__linha">
          <span className="fvs__nome">{s.nome}</span>
          {s.ehEstaAba && <span className="fvs__aqui">esta aba</span>}
          <span className="fvs__estado">{ROTULO[s.estado]}</span>
        </div>
        <div className="fvs__meta">
          <span className="fvs__proj">{s.projeto}</span>
          <span>pid {s.pid}</span>
          <span>{s.desdeMs > 0 ? `ha ${formatAgo(s.desdeMs)}` : '--'}</span>
          <span className="fvs__desde">aberta {formatAgo(agora - s.iniciadaEm)}</span>
        </div>
      </div>
    </div>
  )
}
