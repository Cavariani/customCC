import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { TerminalPane } from './components/TerminalPane'
import { StatusBar } from './components/StatusBar'
import { LimitToast } from './components/LimitToast'
import { AccountsView } from './components/panels/AccountsView'
import { GitView } from './components/panels/GitView'
import { DiffView } from './components/panels/DiffView'
import { SettingsView } from './components/panels/SettingsView'
import { useWorkspace } from './lib/workspace'
import { useTheme } from './theme/useTheme'
import type { ViewName } from './types'

const VIEW_TITLE: Record<ViewName, string> = {
  accounts: 'contas',
  git: 'git',
  diff: 'mudancas',
  settings: 'ajustes',
}

export default function App() {
  const { theme, setTheme } = useTheme()
  const { tabs, activeTabId, notice, git, changes, accounts, setTabStatus } = useWorkspace()
  const [view, setView] = useState<ViewName>('accounts')

  const anyLimited = accounts.some((a) => a.rateLimited)

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
        <div className="panes">
          {tabs.map((tab) => (
            <TerminalPane
              key={tab.id}
              tab={tab}
              visible={tab.id === activeTabId}
              theme={theme}
              notice={notice}
              onStatus={setTabStatus}
            />
          ))}
        </div>
      </main>

      <aside className="dock">
        <h2 className="dock__title">
          {VIEW_TITLE[view]}
          {view === 'accounts' && anyLimited && <span className="dock__alarm">limite</span>}
        </h2>
        <div
          className={`dock__body${view === 'accounts' ? ' dock__body--flush' : ''}`}
          key={view}
        >
          {view === 'accounts' && <AccountsView />}
          {view === 'git' && <GitView />}
          {view === 'diff' && <DiffView />}
          {view === 'settings' && <SettingsView theme={theme} onTheme={setTheme} />}
        </div>
      </aside>

      <StatusBar />
      <LimitToast />
    </div>
  )
}
