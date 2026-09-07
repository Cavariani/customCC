import { useState } from 'react'
import { ChevronRight, GitCompare, History, RotateCcw } from 'lucide-react'
import { useWorkspace } from '../../lib/workspace'
import { formatAgo } from '../../lib/format'
import { useNow } from '../../lib/useNow'
import { Delta } from '../Delta'
import type { ChangedFile } from '../../types'

export function DiffView() {
  const { changes, changesError, revert } = useWorkspace()
  const now = useNow(5000)
  const [open, setOpen] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  if (changesError) {
    return (
      <div className="view">
        <p className="view__note view__note--warn">falha ao montar o diff: {changesError}</p>
      </div>
    )
  }
  if (!changes) return <div className="view"><p className="view__note">lendo as mudancas...</p></div>
  if (changes.files.length === 0) {
    return <div className="view"><p className="view__note">nenhum arquivo alterado ainda.</p></div>
  }

  // Maior arquivo da lista, para a barra de cada linha ter escala comum.
  const biggest = Math.max(...changes.files.map((f) => f.added + f.removed), 1)

  return (
    <div className="view">
      <header className="hero">
        <span className="hero__bracket hero__bracket--tl" aria-hidden="true" />
        <span className="hero__bracket hero__bracket--br" aria-hidden="true" />
        <div className="hero__main">
          <GitCompare size={15} strokeWidth={2} style={{ color: 'var(--warn)' }} />
          <span className="hero__value">{changes.files.length}</span>
          <span className="hero__unit">
            {changes.files.length === 1 ? 'arquivo' : 'arquivos'}
          </span>
        </div>
        <Delta added={changes.totals.added} removed={changes.totals.removed} size="lg" />
      </header>

      {changes.files.map((file, i) => (
        <FileBlock
          key={file.path}
          file={file}
          now={now}
          biggest={biggest}
          index={i}
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

      {erro && <p className="view__note view__note--warn">{erro}</p>}

      <p className="view__note">
        <History size={12} strokeWidth={2} />
        Edit e Write comparam com o backup da sessao; o resto compara com o
        HEAD do git, que e o que pega o escrito por shell.
      </p>
    </div>
  )
}

function FileBlock({
  file,
  now,
  biggest,
  index,
  open,
  onToggle,
  confirming,
  onRevert,
}: {
  file: ChangedFile
  now: number
  biggest: number
  index: number
  open: boolean
  onToggle: () => void
  confirming: boolean
  onRevert: () => void
}) {
  const fresh = file.touchedAt !== null && now - file.touchedAt < 30_000
  const name = file.path.split('/').pop()
  const dir = file.path.slice(0, file.path.length - (name?.length ?? 0))
  const weight = ((file.added + file.removed) / biggest) * 100

  return (
    <section
      className={`dfile${open ? ' is-open' : ''}${fresh ? ' is-fresh' : ''}`}
      style={{ animationDelay: `${index * 26}ms` }}
    >
      <button type="button" className="dfile__head" onClick={onToggle} aria-expanded={open}>
        <ChevronRight size={13} strokeWidth={2} className="dfile__chev" />
        <span className="dfile__id">
          <span className="filerow__name">
            <span className="filerow__dir">{dir}</span>
            {name}
          </span>
          <span className="dfile__meta">
            <span className={`tool tool--${file.source}`}>{file.tool ?? file.source}</span>
            {file.touchedAt !== null && <span className="ago">{formatAgo(now - file.touchedAt)}</span>}
          </span>
        </span>
        <Delta added={file.added} removed={file.removed} />
      </button>

      {/* Peso do arquivo dentro do conjunto: mostra onde a mudanca se concentrou. */}
      <span className="dfile__weight" aria-hidden="true">
        <span style={{ width: `${weight}%` }} />
      </span>

      {open && (
        <>
          <pre className="hunk">
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
            className={`wide-btn wide-btn--ghost${confirming ? ' is-armed' : ''}`}
            onClick={onRevert}
          >
            <RotateCcw size={12} strokeWidth={2} />
            {confirming
              ? `confirmar: desfaz as mudancas de ${file.path.split('/').pop()}`
              : 'reverter arquivo'}
          </button>
        </>
      )}
    </section>
  )
}
