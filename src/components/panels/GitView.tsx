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
  GitMerge,
} from 'lucide-react'
import { useState } from 'react'
import { useWorkspace } from '../../lib/workspace'
import { Delta } from '../Delta'
import { HunkList } from '../HunkList'
import type { GitFile, GitFileStatus, GitState } from '../../types'

const META: Record<GitFileStatus, { Icon: typeof FilePen; color: string; tag: string }> = {
  modified: { Icon: FilePen, color: 'var(--warn)', tag: 'M' },
  added: { Icon: FilePlus2, color: 'var(--green)', tag: 'A' },
  deleted: { Icon: FileMinus2, color: 'var(--color-error)', tag: 'D' },
  renamed: { Icon: FileSymlink, color: 'var(--hl-function)', tag: 'R' },
  untracked: { Icon: FileQuestion, color: 'var(--color-muted)', tag: '?' },
  // Conflito tem entrada propria: antes caia no fallback de "modificado" e
  // aparecia como staged, o que convidava a commitar o arquivo com os
  // marcadores <<<<<<< dentro.
  conflicted: { Icon: GitMerge, color: 'var(--color-error)', tag: 'U' },
}

const OPERACAO: Record<NonNullable<GitState['operation']>, string> = {
  merge: 'merge em andamento',
  rebase: 'rebase em andamento',
  'cherry-pick': 'cherry-pick em andamento',
  revert: 'revert em andamento',
  bisect: 'bisect em andamento',
}

export function GitView() {
  const { git, gitError, activeTab, stage, unstage, commit, refreshGit } = useWorkspace()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [feito, setFeito] = useState<string | null>(null)

  async function acao(fn: () => Promise<unknown>) {
    setBusy(true)
    setErro(null)
    try {
      await fn()
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (gitError) return <Empty warn>falha ao ler o git: {gitError}</Empty>
  if (!git) return <Empty>lendo o repositorio...</Empty>
  // Repo quebrado nao pode se passar por pasta sem versionamento: sao
  // problemas diferentes e so um deles pede conserto.
  if (git.broken !== null) {
    return (
      <Empty warn>
        {activeTab?.cwd} tem um .git que o git recusa ler: {git.broken}
      </Empty>
    )
  }
  if (!git.repo) return <Empty>{activeTab?.cwd} nao esta dentro de um repositorio git.</Empty>

  const staged = git.files.filter((f) => f.staged)
  const unstaged = git.files.filter((f) => !f.staged)
  const conflitados = git.files.filter((f) => f.status === 'conflicted')
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
          <GitBranch
            size={15}
            strokeWidth={2}
            style={{ color: git.detached ? 'var(--warn)' : 'var(--green)' }}
          />
          <span className="hero__value">{git.branch}</span>
          {/* Sem estas marcas, HEAD destacado aparecia como um ramo chamado
              "HEAD" e repo sem commit derrubava a leitura inteira. */}
          {git.detached && <span className="hero__tag">HEAD destacado</span>}
          {git.unborn && <span className="hero__tag">sem commits ainda</span>}
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

      {git.operation !== null && (
        <p className="view__aviso">
          {OPERACAO[git.operation]}
          {conflitados.length > 0 && ` · ${conflitados.length} arquivo(s) em conflito`}
        </p>
      )}

      {git.files.length === 0 && (
        <Empty>{git.unborn ? 'repositorio novo, sem nada para commitar.' : 'nada mudou desde o ultimo commit.'}</Empty>
      )}

      <Group
        title="staged"
        files={staged}
        tone="green"
        action={{ label: 'tirar', run: (p) => acao(() => unstage(p)) }}
        busy={busy}
        cwd={activeTab?.cwd ?? ''}
        staged
        onMoved={refreshGit}
      />
      <Group
        title="nao staged"
        files={unstaged}
        tone="warn"
        action={{ label: 'stage', run: (p) => acao(() => stage(p)) }}
        busy={busy}
        cwd={activeTab?.cwd ?? ''}
        staged={false}
        onMoved={refreshGit}
      />

      {git.truncated && <p className="view__note view__note--warn">lista cortada em 250 arquivos.</p>}

      {git.files.length > 0 && (
        <section className="commit">
          <textarea
            className="commit__msg"
            rows={3}
            value={message}
            placeholder="mensagem do commit"
            disabled={busy}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                void acao(async () => {
                  const r = await commit(message, staged.length === 0)
                  setMessage('')
                  setFeito(`${r.hash} ${r.subject}`)
                })
              }
            }}
          />
          <div className="commit__row">
            <span className="commit__hint">
              {staged.length > 0
                ? `${staged.length} staged`
                : 'nada staged: vai commitar os rastreados'}
              {' · cmd+enter'}
            </span>
            <button
              type="button"
              className="wide-btn wide-btn--go"
              disabled={busy || !message.trim()}
              onClick={() =>
                void acao(async () => {
                  const r = await commit(message, staged.length === 0)
                  setMessage('')
                  setFeito(`${r.hash} ${r.subject}`)
                })
              }
            >
              <GitCommitHorizontal size={13} strokeWidth={2} /> commit
            </button>
          </div>
          {erro && <p className="view__note view__note--warn">{erro}</p>}
          {feito && !erro && <p className="commit__done">{feito}</p>}
        </section>
      )}
    </div>
  )
}

interface GroupAction {
  label: string
  run: (paths: string[]) => void
}

function Group({
  title,
  files,
  tone,
  action,
  busy,
  cwd,
  staged,
  onMoved,
}: {
  title: string
  files: GitFile[]
  tone: string
  action: GroupAction
  busy: boolean
  cwd: string
  staged: boolean
  onMoved: () => void
}) {
  // Um arquivo aberto de cada vez: dois diffs abertos no painel de 372px
  // viram rolagem sem fim.
  const [aberto, setAberto] = useState<string | null>(null)
  if (files.length === 0) return null
  return (
    <section className="group">
      <h4 className={`group__title group__title--${tone}`}>
        <span className="group__tick" />
        {title} <span className="group__count">{files.length}</span>
        <button
          type="button"
          className="group__all"
          disabled={busy}
          onClick={() => action.run(files.map((f) => f.path))}
        >
          {action.label} tudo
        </button>
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
              {/* Conflito e arquivo novo nao tem bloco util para separar:
                  o primeiro precisa ser resolvido antes, e o segundo e um
                  bloco so com o arquivo inteiro dentro. */}
              {file.status !== 'conflicted' && file.status !== 'untracked' && (
                <button
                  type="button"
                  className={`filerow__blocos${aberto === file.path ? ' is-on' : ''}`}
                  title="ver e mover bloco a bloco"
                  onClick={() => setAberto(aberto === file.path ? null : file.path)}
                >
                  blocos
                </button>
              )}
              <button
                type="button"
                className="filerow__act"
                disabled={busy}
                title={`${action.label} ${file.path}`}
                onClick={() => action.run([file.path])}
              >
                {action.label}
              </button>
              {aberto === file.path && (
                <HunkList cwd={cwd} path={file.path} staged={staged} onMoved={onMoved} />
              )}
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
