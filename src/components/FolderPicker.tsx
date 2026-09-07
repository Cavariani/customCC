import { useEffect, useRef, useState } from 'react'
import { Check, FolderOpen, Search, X } from 'lucide-react'

interface RecentProject {
  cwd: string
  name: string
  lastUsedAt: number
  sessions: number
}

interface Props {
  onPick: (cwd: string) => void
  onClose: () => void
}

/**
 * Escolhe a pasta de uma aba nova. A lista vem dos projetos onde o Claude
 * Code ja rodou, e o campo aceita um caminho digitado, validado no servidor
 * antes de abrir para nao subir um pty num diretorio que nao existe.
 */
export function FolderPicker({ onPick, onClose }: Props) {
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    fetch('/api/projects')
      .then((r) => r.json())
      .then((d: { projects: RecentProject[] }) => setProjects(d.projects ?? []))
      .catch(() => setProjects([]))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const looksLikePath = query.includes('/') || query.includes('\\') || query.startsWith('~')
  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      p.cwd.toLowerCase().includes(query.toLowerCase()),
  )

  async function openTyped() {
    setError(null)
    const response = await fetch(`/api/resolve-path?path=${encodeURIComponent(query)}`)
    const data = await response.json()
    if (data.ok) onPick(data.cwd)
    else setError(`${query}: ${data.reason ?? 'caminho invalido'}`)
  }

  return (
    <div className="picker__backdrop" onMouseDown={onClose}>
      <div
        className="picker"
        role="dialog"
        aria-label="Escolher pasta"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="picker__search">
          <Search size={13} strokeWidth={2} />
          <input
            ref={inputRef}
            value={query}
            placeholder="filtrar projetos, ou colar um caminho"
            onChange={(e) => {
              setQuery(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              if (looksLikePath) void openTyped()
              else if (filtered[0]) onPick(filtered[0].cwd)
            }}
          />
          <button type="button" className="picker__close" onClick={onClose} aria-label="Fechar">
            <X size={13} strokeWidth={2.2} />
          </button>
        </div>

        {looksLikePath && (
          <button type="button" className="picker__row picker__row--typed" onClick={openTyped}>
            <FolderOpen size={13} strokeWidth={1.9} />
            <span className="picker__path">{query}</span>
            <Check size={12} strokeWidth={2.4} />
          </button>
        )}

        {error && <p className="picker__error">{error}</p>}

        <ul className="picker__list">
          {filtered.map((project) => (
            <li key={project.cwd}>
              <button type="button" className="picker__row" onClick={() => onPick(project.cwd)}>
                <FolderOpen size={13} strokeWidth={1.9} />
                <span className="picker__name">{project.name}</span>
                <span className="picker__path">{project.cwd}</span>
                <span className="picker__meta">{project.sessions}</span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && !looksLikePath && (
            <li className="picker__none">nenhum projeto recente com esse nome</li>
          )}
        </ul>
      </div>
    </div>
  )
}
