import { useEffect, useRef, useState } from 'react'
import { Plus, TerminalSquare, X } from 'lucide-react'
import { useWorkspace } from '../lib/workspace'

export function TabBar() {
  const { tabs, activeTabId, setActiveTabId, openTab, closeTab, renameTab, tabStatus } =
    useWorkspace()
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <div className="tabbar" role="tablist" aria-label="Terminais">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab${tab.id === activeTabId ? ' is-active' : ''}`}
        >
          {editing === tab.id ? (
            <RenameInput
              initial={tab.title}
              onDone={(value) => {
                if (value) renameTab(tab.id, value)
                setEditing(null)
              }}
            />
          ) : (
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              className="tab__main"
              onClick={() => setActiveTabId(tab.id)}
              onDoubleClick={() => setEditing(tab.id)}
              title={`${tab.cwd}\nduplo clique para renomear`}
            >
              <TerminalSquare size={13} strokeWidth={1.8} />
              <span className="tab__title">{tab.title}</span>
              <span
                className={`tab__status tab__status--${tabStatus[tab.id] ?? 'connecting'}`}
                title={tabStatus[tab.id] ?? 'connecting'}
              />
            </button>
          )}

          {tabs.length > 1 && editing !== tab.id && (
            <button
              type="button"
              className="tab__close"
              aria-label={`Fechar ${tab.title}`}
              onClick={() => closeTab(tab.id)}
            >
              <X size={12} strokeWidth={2.2} />
            </button>
          )}
        </div>
      ))}

      <button type="button" className="tabbar__add" onClick={openTab} aria-label="Nova aba">
        <Plus size={14} strokeWidth={2} />
      </button>

      <span className="tabbar__hint">duplo clique renomeia</span>
    </div>
  )
}

/** Renomeia no lugar: Enter confirma, Esc cancela, sair do campo confirma. */
function RenameInput({
  initial,
  onDone,
}: {
  initial: string
  onDone: (value: string | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      className="tab__rename"
      value={value}
      maxLength={40}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value)
        else if (e.key === 'Escape') onDone(null)
        e.stopPropagation()
      }}
    />
  )
}
