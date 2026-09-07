import {
  ArrowDown,
  ArrowUp,
  FileMinus2,
  FilePen,
  FilePlus2,
  FileQuestion,
  FileSymlink,
  GitBranch,
  GitCommitHorizontal,
} from 'lucide-react'
import { useWorkspace } from '../../lib/workspace'
import type { GitFile, GitFileStatus } from '../../types'

const STATUS_META: Record<
  GitFileStatus,
  { Icon: typeof FilePen; color: string }
> = {
  modified: { Icon: FilePen, color: 'var(--warn)' },
  added: { Icon: FilePlus2, color: 'var(--green)' },
  deleted: { Icon: FileMinus2, color: 'var(--color-error)' },
  renamed: { Icon: FileSymlink, color: 'var(--hl-function)' },
  untracked: { Icon: FileQuestion, color: 'var(--color-muted)' },
}

export function GitView() {
  const { git, gitError, activeTab } = useWorkspace()

  if (gitError) {
    return (
      <div className="view">
        <p className="view__note view__note--warn">falha ao ler o git: {gitError}</p>
      </div>
    )
  }
  if (!git) {
    return <div className="view"><p className="view__note">lendo o repositorio...</p></div>
  }
  if (!git.repo) {
    return (
      <div className="view">
        <p className="view__note">{activeTab?.cwd} nao esta dentro de um repositorio git.</p>
      </div>
    )
  }

  const staged = git.files.filter((f) => f.staged)
  const unstaged = git.files.filter((f) => !f.staged)

  return (
    <div className="view">
      <div className="branch">
        <GitBranch size={14} strokeWidth={1.9} style={{ color: 'var(--green)' }} />
        <span className="branch__name">{git.branch}</span>
        {(git.ahead > 0 || git.behind > 0) && (
          <span className="branch__sync">
            <ArrowUp size={11} strokeWidth={2.2} />
            {git.ahead}
            <ArrowDown size={11} strokeWidth={2.2} />
            {git.behind}
          </span>
        )}
      </div>

      {git.files.length === 0 && <p className="view__note">nada mudou desde o ultimo commit.</p>}

      <Group title="staged" files={staged} />
      <Group title="nao staged" files={unstaged} />

      {git.truncated && (
        <p className="view__note view__note--warn">
          lista cortada em 250 arquivos.
        </p>
      )}

      <button type="button" className="wide-btn" disabled>
        <GitCommitHorizontal size={13} strokeWidth={2} /> commit (ainda nao ligado)
      </button>
    </div>
  )
}

function Group({ title, files }: { title: string; files: GitFile[] }) {
  if (files.length === 0) return null
  return (
    <section className="group">
      <h4 className="group__title">
        {title} <span className="group__count">{files.length}</span>
      </h4>
      <ul className="filelist">
        {files.map((file) => {
          const meta = STATUS_META[file.status] ?? STATUS_META.modified
          const name = file.path.split('/').pop()
          const dir = file.path.slice(0, file.path.length - (name?.length ?? 0))
          return (
            <li key={`${file.path}-${file.staged}`} className="filerow" title={file.path}>
              <meta.Icon size={13} strokeWidth={1.8} style={{ color: meta.color }} />
              <span className="filerow__name">
                <span className="filerow__dir">{dir}</span>
                {name}
              </span>
              <span className="filerow__stat">
                {file.added > 0 && <span className="stat stat--add">+{file.added}</span>}
                {file.removed > 0 && <span className="stat stat--del">-{file.removed}</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
