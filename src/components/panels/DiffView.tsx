import { useState } from 'react'
import { ChevronRight, History, RotateCcw } from 'lucide-react'
import { useWorkspace } from '../../lib/workspace'
import { formatAgo } from '../../lib/format'
import { useNow } from '../../lib/useNow'
import type { ChangedFile } from '../../types'

export function DiffView() {
  const { changes, changesError } = useWorkspace()
  const now = useNow(5000)
  const [open, setOpen] = useState<string | null>(null)

  if (changesError) {
    return (
      <div className="view">
        <p className="view__note view__note--warn">falha ao montar o diff: {changesError}</p>
      </div>
    )
  }
  if (!changes) {
    return <div className="view"><p className="view__note">lendo as mudancas...</p></div>
  }
  if (changes.files.length === 0) {
    return <div className="view"><p className="view__note">nenhum arquivo alterado ainda.</p></div>
  }

  return (
    <div className="view">
      <div className="difftotal">
        <span className="difftotal__label">
          {changes.files.length} {changes.files.length === 1 ? 'arquivo' : 'arquivos'}
        </span>
        <span className="filerow__stat">
          <span className="stat stat--add">+{changes.totals.added}</span>
          <span className="stat stat--del">-{changes.totals.removed}</span>
        </span>
      </div>

      {changes.files.map((file) => (
        <FileBlock
          key={file.path}
          file={file}
          now={now}
          open={open === file.path}
          onToggle={() => setOpen(open === file.path ? null : file.path)}
        />
      ))}

      <p className="view__note">
        <History size={12} strokeWidth={2} />
        Arquivo tocado por Edit ou Write compara com o backup da sessao; o
        resto compara com o HEAD do git, que e o que pega o que foi escrito
        por shell.
      </p>
    </div>
  )
}

function FileBlock({
  file,
  now,
  open,
  onToggle,
}: {
  file: ChangedFile
  now: number
  open: boolean
  onToggle: () => void
}) {
  const fresh = file.touchedAt !== null && now - file.touchedAt < 30_000
  const name = file.path.split('/').pop()
  const dir = file.path.slice(0, file.path.length - (name?.length ?? 0))

  return (
    <section className={`dfile${open ? ' is-open' : ''}${fresh ? ' is-fresh' : ''}`}>
      <button type="button" className="dfile__head" onClick={onToggle} aria-expanded={open}>
        <ChevronRight size={13} strokeWidth={2} className="dfile__chev" />
        <span className="filerow__name">
          <span className="filerow__dir">{dir}</span>
          {name}
        </span>
        <span className="dfile__meta">
          <span className={`tool tool--${file.source}`}>{file.tool ?? file.source}</span>
          {file.touchedAt !== null && <span className="ago">{formatAgo(now - file.touchedAt)}</span>}
        </span>
        <span className="filerow__stat">
          {file.added > 0 && <span className="stat stat--add">+{file.added}</span>}
          {file.removed > 0 && <span className="stat stat--del">-{file.removed}</span>}
        </span>
      </button>

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
          <button type="button" className="wide-btn wide-btn--ghost" disabled>
            <RotateCcw size={12} strokeWidth={2} /> reverter arquivo (ainda nao ligado)
          </button>
        </>
      )}
    </section>
  )
}
