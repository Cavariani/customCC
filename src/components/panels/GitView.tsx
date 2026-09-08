import {
  ArrowDown,
  ArrowUp,
  FileMinus2,
  FilePen,
  FilePlus2,
  FileQuestion,
  FileSymlink,
  GitMerge,
} from 'lucide-react'
import { useState } from 'react'
import { useWorkspace } from '../../lib/workspace'
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
    <div className="gv">
      {/* Cabecalho na mesma forma do painel de contas: o nome em destaque,
          e a linha de baixo com os secundarios. Antes era uma caixa com
          borda e colchetes, a unica na tela depois que as contas
          perderam as suas. */}
      <div className="gv__topo">
        <div className="gv__linha">
          <span className="gv__ramo">{git.branch}</span>
          {git.detached && <span className="gv__marca">HEAD destacado</span>}
          {git.unborn && <span className="gv__marca">sem commits</span>}
          <span className="gv__sync">
            <ArrowUp size={9} strokeWidth={2.6} />
            {git.ahead}
            <ArrowDown size={9} strokeWidth={2.6} />
            {git.behind}
          </span>
        </div>
        <div className="gv__split">
          <span>
            adicionadas <b className="gv__mais">{totals.added}</b>
          </span>
          <span>
            removidas <b className="gv__menos">{totals.removed}</b>
          </span>
          <span>
            arquivos <b>{git.files.length}</b>
          </span>
        </div>
      </div>

      {git.operation !== null && (
        <p className="gv__aviso">
          {OPERACAO[git.operation]}
          {conflitados.length > 0 && ` · ${conflitados.length} arquivo(s) em conflito`}
        </p>
      )}

      {git.files.length === 0 && (
        <p className="gv__vazio">
          {git.unborn ? 'repositorio novo, sem nada para commitar.' : 'nada mudou desde o ultimo commit.'}
        </p>
      )}

      <div className="gv__lista">
        <Group
          title="staged"
          files={staged}
          action={{ label: 'tirar', run: (p) => acao(() => unstage(p)) }}
          busy={busy}
          cwd={activeTab?.cwd ?? ''}
          staged
          onMoved={refreshGit}
        />
        <Group
          title="nao staged"
          files={unstaged}
          action={{ label: 'stage', run: (p) => acao(() => stage(p)) }}
          busy={busy}
          cwd={activeTab?.cwd ?? ''}
          staged={false}
          onMoved={refreshGit}
        />

        {git.truncated && <p className="gv__aviso">lista cortada em 250 arquivos.</p>}
      </div>

      {git.files.length > 0 && (
        <div className="gv__commit">
          <div className="gv__cols">
            <span>mensagem</span>
            <span className="gv__cols-r">
              {staged.length > 0 ? `${staged.length} staged` : 'sem staged: vai os rastreados'}
            </span>
          </div>
          <textarea
            className="gv__msg"
            rows={2}
            value={message}
            placeholder="o que mudou"
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
          {/* Faixa de largura total, como a acao das contas. */}
          <button
            type="button"
            className="gv__acao"
            disabled={busy || !message.trim()}
            onClick={() =>
              void acao(async () => {
                const r = await commit(message, staged.length === 0)
                setMessage('')
                setFeito(`${r.hash} ${r.subject}`)
              })
            }
          >
            commit · cmd+enter
          </button>
          {erro && <p className="gv__aviso">{erro}</p>}
          {feito && !erro && <p className="gv__feito">{feito}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * Corta o comeco do caminho, preservando o nome do arquivo inteiro.
 *
 * Feito aqui, e nao no CSS: o `direction: rtl` que trunca a esquerda
 * inverte a ordem dos filhos, e o caminho saia como "GitView.tsx" seguido
 * de "src/components/panels/".
 */
function encurtaDir(dir: string): string {
  const MAX = 20
  return dir.length > MAX ? `…${dir.slice(-(MAX - 1))}` : dir
}

interface GroupAction {
  label: string
  run: (paths: string[]) => void
}

function Group({
  title,
  files,
  action,
  busy,
  cwd,
  staged,
  onMoved,
}: {
  title: string
  files: GitFile[]
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
    <section className="gv__grupo">
      {/* Regua de colunas, igual a do painel de contas. */}
      <div className="gv__cols">
        <span>
          {title} <b>{files.length}</b>
        </span>
        <button type="button" className="gv__todos" disabled={busy} onClick={() => action.run(files.map((f) => f.path))}>
          {action.label} tudo
        </button>
      </div>

      <ul className="gv__arquivos">
        {files.map((file) => {
          const meta = META[file.status] ?? META.modified
          const name = file.path.split('/').pop() ?? file.path
          const dir = encurtaDir(file.path.slice(0, file.path.length - name.length))
          const temBlocos = file.status !== 'conflicted' && file.status !== 'untracked'
          return (
            <li key={`${file.path}-${file.staged}`} className="gvf" title={file.path}>
              <div className="gvf__linha">
                <span className="gvf__tag" style={{ color: meta.color }}>
                  {meta.tag}
                </span>
                <span className="gvf__nome">
                  <span className="gvf__dir">{dir}</span>
                  {name}
                </span>
                {/* Numeros em coluna fixa, para os arquivos alinharem entre
                    si em vez de cada um parar onde o nome terminou. */}
                <b className="gvf__mais">{file.added > 0 ? `+${file.added}` : ''}</b>
                <b className="gvf__menos">{file.removed > 0 ? `-${file.removed}` : ''}</b>
              </div>

              <div className="gvf__acoes">
                {temBlocos && (
                  <button
                    type="button"
                    className={`gvf__link${aberto === file.path ? ' is-on' : ''}`}
                    onClick={() => setAberto(aberto === file.path ? null : file.path)}
                  >
                    blocos
                  </button>
                )}
                <button
                  type="button"
                  className="gvf__link"
                  disabled={busy}
                  onClick={() => action.run([file.path])}
                >
                  {action.label}
                </button>
              </div>

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
