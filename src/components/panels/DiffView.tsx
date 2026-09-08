import { useState } from 'react'
import { useWorkspace } from '../../lib/workspace'
import { formatAgo } from '../../lib/format'
import { useNow } from '../../lib/useNow'
import type { ChangedFile } from '../../types'

export function DiffView() {
  const { changes, changesError, revert } = useWorkspace()
  const now = useNow(5000)
  const [open, setOpen] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  if (changesError) {
    return (
      <div className="dv">
        <p className="gv__aviso">falha ao montar o diff: {changesError}</p>
      </div>
    )
  }
  if (!changes) {
    return (
      <div className="dv">
        <p className="gv__vazio">lendo as mudancas...</p>
      </div>
    )
  }
  if (changes.files.length === 0) {
    return (
      <div className="dv">
        <p className="gv__vazio">nenhum arquivo alterado ainda.</p>
      </div>
    )
  }

  // Maior arquivo da lista, para a barra de cada linha ter escala comum.
  const biggest = Math.max(...changes.files.map((f) => f.added + f.removed), 1)

  return (
    <div className="dv">
      {/* Mesma forma do topo das contas e do git: numero em destaque e os
          secundarios na linha de baixo, sem caixa. */}
      <div className="dv__topo">
        <div className="dv__linha">
          <span className="dv__n">{changes.files.length}</span>
          <span className="dv__k">
            {changes.files.length === 1 ? 'arquivo alterado' : 'arquivos alterados'}
          </span>
        </div>
        <div className="dv__split">
          <span>
            adicionadas <b className="dv__mais">{changes.totals.added}</b>
          </span>
          <span>
            removidas <b className="dv__menos">{changes.totals.removed}</b>
          </span>
        </div>
      </div>

      <div className="gv__cols">
        <span>arquivo</span>
        <span className="gv__cols-r">linhas</span>
      </div>

      <div className="dv__lista">
        {changes.files.map((file) => (
          <FileBlock
            key={file.path}
            file={file}
            now={now}
            biggest={biggest}
            open={open === file.path}
            onToggle={() => setOpen(open === file.path ? null : file.path)}
            confirming={confirmando === file.path}
            onRevert={() => {
              if (confirmando !== file.path) {
                setConfirmando(file.path)
                setErro(null)
                return
              }
              setConfirmando(null)
              revert(file.path).catch((e) => setErro(e instanceof Error ? e.message : String(e)))
            }}
          />
        ))}
      </div>

      {erro && <p className="gv__aviso">{erro}</p>}

      <p className="dv__rodape">
        Edit e Write comparam com o backup da sessao; o resto compara com o HEAD do git, que e o
        que pega o escrito por shell.
      </p>
    </div>
  )
}

/** Corta o comeco do caminho, preservando o nome do arquivo inteiro. */
function encurtaDir(dir: string): string {
  const MAX = 20
  return dir.length > MAX ? `…${dir.slice(-(MAX - 1))}` : dir
}

function FileBlock({
  file,
  now,
  biggest,
  open,
  onToggle,
  confirming,
  onRevert,
}: {
  file: ChangedFile
  now: number
  biggest: number
  open: boolean
  onToggle: () => void
  confirming: boolean
  onRevert: () => void
}) {
  const name = file.path.split('/').pop() ?? file.path
  const dir = encurtaDir(file.path.slice(0, file.path.length - name.length))
  const peso = ((file.added + file.removed) / biggest) * 100

  return (
    <div className={`dvf${open ? ' is-open' : ''}`}>
      <button type="button" className="dvf__linha" onClick={onToggle} aria-expanded={open}>
        <span className="dvf__seta" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="dvf__nome" title={file.path}>
          <span className="dvf__dir">{dir}</span>
          {name}
        </span>
        <b className="gvf__mais">{file.added > 0 ? `+${file.added}` : ''}</b>
        <b className="gvf__menos">{file.removed > 0 ? `-${file.removed}` : ''}</b>
      </button>

      {/* Peso do arquivo no conjunto, no mesmo desenho segmentado dos
          medidores das contas. */}
      <div className="dvf__peso" aria-hidden="true">
        <span style={{ width: `${peso}%` }} />
      </div>

      <div className="dvf__meta">
        <span>{file.tool ?? file.source}</span>
        {file.touchedAt !== null && <span>{formatAgo(now - file.touchedAt)}</span>}
      </div>

      {open && (
        <>
          <pre className="dvf__diff">
            {file.lines.map((line, i) => (
              <code key={i} className={`hl hl--${line.kind}`}>
                <span className="hl__no">{line.lineNo ?? ''}</span>
                <span className="hl__sign">
                  {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}
                </span>
                <span className="hl__text">{line.text || ' '}</span>
              </code>
            ))}
          </pre>
          {/* Dois toques: reverter sobrescreve o arquivo em disco. */}
          <button
            type="button"
            className={`dvf__acao${confirming ? ' is-armed' : ''}`}
            onClick={onRevert}
          >
            {confirming ? `confirmar · sobrescreve ${name}` : 'reverter arquivo'}
          </button>
        </>
      )}
    </div>
  )
}
