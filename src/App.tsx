import { useEffect, useState } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { ProjectBar } from './components/ProjectBar'
import { TerminalPane } from './components/TerminalPane'
import { StatusBar } from './components/StatusBar'
import { LimitToast } from './components/LimitToast'
import { AccountsView } from './components/panels/AccountsView'
import { GitView } from './components/panels/GitView'
import { DiffView } from './components/panels/DiffView'
import { SettingsView } from './components/panels/SettingsView'
import { useWorkspace } from './lib/workspace'
import { useTheme } from './theme/useTheme'
import { usePrefs } from './lib/usePrefs'
import { useNotifier } from './lib/useNotifier'
import { DockRail } from './components/DockRail'
import { OfflineBanner } from './components/OfflineBanner'
import type { ViewName } from './types'

const VIEW_TITLE: Record<ViewName, string> = {
  accounts: 'contas',
  git: 'git',
  diff: 'mudancas',
  settings: 'ajustes',
}

export default function App() {
  const { theme, setTheme } = useTheme()
  const { prefs, set, toggleDock } = usePrefs()
  const {
    tabs,
    activeTabId,
    notice,
    git,
    changes,
    accounts,
    setTabStatus,
    setTabActivity,
    tabActivity,
  } = useWorkspace()
  // A secao aberta vive no hash: recarregar a pagina volta para onde estava,
  // e da para deixar o painel de git como bookmark.
  const [view, setView] = useState<ViewName>(() => {
    const hash = location.hash.replace('#', '')
    return (hash in VIEW_TITLE ? hash : 'accounts') as ViewName
  })

  useEffect(() => {
    if (location.hash.replace('#', '') !== view) history.replaceState(null, '', `#${view}`)
  }, [view])

  useNotifier(tabs, tabActivity, activeTabId, prefs.notify)

  const anyLimited = accounts.some((a) => a.rateLimited)

  // Recolher e expandir o painel sem tirar a mao do teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        toggleDock()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleDock])

  return (
    <div className="shell">
      <Sidebar
        view={view}
        onView={setView}
        badges={{ git: git?.files.length ?? 0, diff: changes?.files.length ?? 0 }}
        alert={anyLimited}
      />

      <main className="main">
        <TabBar />
        <ProjectBar />
        <div className="panes">
          {tabs.map((tab) => (
            <TerminalPane
              key={tab.id}
              tab={tab}
              visible={tab.id === activeTabId}
              fontSize={prefs.terminalFontSize}
              theme={theme}
              notice={notice}
              onStatus={setTabStatus}
              onActivity={setTabActivity}
            />
          ))}
        </div>
      </main>

      <aside className="dock">
        <h2 className="dock__title">
          {!prefs.dockCollapsed && VIEW_TITLE[view]}
          {!prefs.dockCollapsed && view === 'accounts' && anyLimited && (
            <span className="dock__alarm">limite</span>
          )}
          <button
            type="button"
            className="dock__toggle"
            onClick={toggleDock}
            aria-label={prefs.dockCollapsed ? 'Expandir painel' : 'Recolher painel'}
            title={`${prefs.dockCollapsed ? 'expandir' : 'recolher'} painel  cmd+B`}
          >
            {prefs.dockCollapsed ? (
              <PanelRightOpen size={14} strokeWidth={1.9} />
            ) : (
              <PanelRightClose size={14} strokeWidth={1.9} />
            )}
          </button>
        </h2>
        <div
          className={`dock__body${view === 'accounts' ? ' dock__body--flush' : ''}`}
          key={prefs.dockCollapsed ? 'rail' : view}
        >
          {prefs.dockCollapsed ? (
            <DockRail onExpand={toggleDock} />
          ) : (
            <>
              {view === 'accounts' && <AccountsView animations={prefs.animations} />}
              {view === 'git' && <GitView />}
              {view === 'diff' && <DiffView />}
              {view === 'settings' && (
                <SettingsView theme={theme} onTheme={setTheme} prefs={prefs} onPref={set} />
              )}
            </>
          )}
        </div>
      </aside>

      <OfflineBanner />
      <StatusBar animations={prefs.animations} />
      <LimitToast />
    </div>
  )
}
