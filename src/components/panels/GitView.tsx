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
import { Delta } from '../Delta'
import type { GitFile, GitFileStatus } from '../../types'

const META: Record<GitFileStatus, { Icon: typeof FilePen; color: string; tag: string }> = {
  modified: { Icon: FilePen, color: 'var(--warn)', tag: 'M' },
  added: { Icon: FilePlus2, color: 'var(--green)', tag: 'A' },
  deleted: { Icon: FileMinus2, color: 'var(--color-error)', tag: 'D' },
  renamed: { Icon: FileSymlink, color: 'var(--hl-function)', tag: 'R' },
  untracked: { Icon: FileQuestion, color: 'var(--color-muted)', tag: '?' },
}

export function GitView() {
  const { git, gitError, activeTab } = useWorkspace()

  if (gitError) return <Empty warn>falha ao ler o git: {gitError}</Empty>
  if (!git) return <Empty>lendo o repositorio...</Empty>
  if (!git.repo) return <Empty>{activeTab?.cwd} nao esta dentro de um repositorio git.</Empty>

  const staged = git.files.filter((f) => f.staged)
  const unstaged = git.files.filter((f) => !f.staged)
  const totals = git.files.reduce(
    (acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
    { added: 0, removed: 0 },
  )

  return (
    <div className="view">
      <header className="hero">
        <span className="hero__bracket hero__bracket--tl" aria-hidden="true" />
        <span className="hero__bracket hero__bracket--br" aria-hidden="true" />

        <div className="hero__main">
          <GitBranch size={15} strokeWidth={2} style={{ color: 'var(--green)' }} />
          <span className="hero__value">{git.branch}</span>
        </div>

        <div className="hero__side">
          <Delta added={totals.added} removed={totals.removed} size="md" bar />
          <span className="hero__sync">
            <ArrowUp size={10} strokeWidth={2.6} />
            {git.ahead}
            <ArrowDown size={10} strokeWidth={2.6} />
            {git.behind}
          </span>
        </div>
      </header>

      {git.files.length === 0 && <Empty>nada mudou desde o ultimo commit.</Empty>}

      <Group title="staged" files={staged} tone="green" />
      <Group title="nao staged" files={unstaged} tone="warn" />

      {git.truncated && <p className="view__note view__note--warn">lista cortada em 250 arquivos.</p>}

      {git.files.length > 0 && (
        <button type="button" className="wide-btn" disabled>
          <GitCommitHorizontal size={13} strokeWidth={2} /> commit (ainda nao ligado)
        </button>
      )}
    </div>
  )
}

function Group({ title, files, tone }: { title: string; files: GitFile[]; tone: string }) {
  if (files.length === 0) return null
  return (
    <section className="group">
      <h4 className={`group__title group__title--${tone}`}>
        <span className="group__tick" />
        {title} <span className="group__count">{files.length}</span>
      </h4>
      <ul className="filelist">
        {files.map((file, i) => {
          const meta = META[file.status] ?? META.modified
          const name = file.path.split('/').pop()
          const dir = file.path.slice(0, file.path.length - (name?.length ?? 0))
          return (
            <li
              key={`${file.path}-${file.staged}`}
              className="filerow"
              title={file.path}
              style={{ animationDelay: `${i * 22}ms` }}
            >
              <span className="filerow__tag" style={{ color: meta.color }}>
                {meta.tag}
              </span>
              <meta.Icon size={12} strokeWidth={1.9} style={{ color: meta.color }} />
              <span className="filerow__name">
                <span className="filerow__dir">{dir}</span>
                {name}
              </span>
              <Delta added={file.added} removed={file.removed} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Empty({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <div className="view">
      <p className={`view__note${warn ? ' view__note--warn' : ''}`}>{children}</p>
    </div>
  )
}
