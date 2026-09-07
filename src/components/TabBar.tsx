import { Plus, TerminalSquare, X } from 'lucide-react'
import { useWorkspace } from '../lib/workspace'

export function TabBar() {
  const { tabs, activeTabId, setActiveTabId, openTab, closeTab, tabStatus } =
    useWorkspace()

  return (
    <div className="tabbar" role="tablist" aria-label="Terminais">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab${tab.id === activeTabId ? ' is-active' : ''}`}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab.id === activeTabId}
            className="tab__main"
            onClick={() => setActiveTabId(tab.id)}
            title={tab.cwd}
          >
            <TerminalSquare size={13} strokeWidth={1.8} />
            <span className="tab__title">{tab.title}</span>
            <span
              className={`tab__status tab__status--${tabStatus[tab.id] ?? 'connecting'}`}
              title={tabStatus[tab.id] ?? 'connecting'}
            />
          </button>
          {tabs.length > 1 && (
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
    </div>
  )
}
