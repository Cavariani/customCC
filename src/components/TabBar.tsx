import { useEffect, useRef, useState } from 'react'
import { FolderOpen, FolderSymlink, Plus, TerminalSquare, X } from 'lucide-react'
import { useWorkspace } from '../lib/workspace'
import { FolderPicker } from './FolderPicker'

const ACTIVITY_LABEL: Record<string, string> = {
  working: 'trabalhando',
  waiting: 'esperando voce',
  idle: 'parado',
}

export function TabBar() {
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    openTab,
    closeTab,
    renameTab,
    moveTab,
    tabStatus,
    tabActivity,
  } = useWorkspace()
  const [editing, setEditing] = useState<string | null>(null)
  // 'nova' abre outra aba; um id move aquela aba de pasta.
  const [picking, setPicking] = useState<'nova' | string | null>(null)

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
                className={`tab__status tab__status--${
                  tabStatus[tab.id] === 'live'
                    ? (tabActivity[tab.id] ?? 'idle')
                    : (tabStatus[tab.id] ?? 'connecting')
                }`}
                title={
                  tabStatus[tab.id] === 'live'
                    ? ACTIVITY_LABEL[tabActivity[tab.id] ?? 'idle']
                    : (tabStatus[tab.id] ?? 'conectando')
                }
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

      <button
        type="button"
        className="tabbar__add"
        onClick={() => openTab()}
        aria-label="Nova aba na mesma pasta"
        title="nova aba na mesma pasta"
      >
        <Plus size={14} strokeWidth={2} />
      </button>

      <button
        type="button"
        className="tabbar__add"
        onClick={() => setPicking('nova')}
        aria-label="Abrir outra pasta em nova aba"
        title="abrir outra pasta em nova aba"
      >
        <FolderOpen size={14} strokeWidth={1.9} />
      </button>

      <button
        type="button"
        className="tabbar__add"
        onClick={() => setPicking(activeTabId)}
        aria-label="Mover esta aba para outra pasta"
        title="mover esta aba para outra pasta"
      >
        <FolderSymlink size={14} strokeWidth={1.9} />
      </button>

      <span className="tabbar__hint">duplo clique renomeia</span>

      {picking && (
        <FolderPicker
          onClose={() => setPicking(null)}
          onPick={(cwd) => {
            const alvo = picking
            setPicking(null)
            if (alvo === 'nova') openTab(cwd)
            else if (alvo) moveTab(alvo, cwd)
          }}
        />
      )}
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
