import { FolderOpen } from 'lucide-react'
import { useWorkspace } from '../lib/workspace'

/**
 * Diz, sem ambiguidade, em que pasta a aba aberta esta rodando. Com varias
 * abas em projetos diferentes, saber onde o `claude` vai escrever e a
 * informacao mais cara de errar.
 */
export function ProjectBar() {
  const { activeTab } = useWorkspace()
  if (!activeTab?.cwd) return null

  const parts = activeTab.cwd.split(/[/\\]/).filter(Boolean)
  const name = parts.pop() ?? activeTab.cwd
  const parent = parts.join('/')

  return (
    <div className="projectbar" title={activeTab.cwd}>
      <FolderOpen size={13} strokeWidth={2} />
      <span className="projectbar__parent">{parent ? `/${parent}/` : ''}</span>
      <strong className="projectbar__name">{name}</strong>
    </div>
  )
}
