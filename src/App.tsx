import { useEffect, useMemo, useState } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { ProjectBar } from './components/ProjectBar'
import { TerminalPane } from './components/TerminalPane'
import { StatusBar } from './components/StatusBar'
import { LimitToast } from './components/LimitToast'
import { AccountsView } from './components/panels/AccountsView'
import { GitView } from './components/panels/GitView'
import { DiffView } from './components/panels/DiffView'
import { HistoryView } from './components/panels/HistoryView'
import { SettingsView } from './components/panels/SettingsView'
import { useWorkspace } from './lib/workspace'
import { useTheme } from './theme/useTheme'
import { usePrefs } from './lib/usePrefs'
import { useNotifier } from './lib/useNotifier'
import { DockRail } from './components/DockRail'
import { OfflineBanner } from './components/OfflineBanner'
import { CommandPalette, CMD_ICONS, type Command } from './components/CommandPalette'
import { FolderPicker } from './components/FolderPicker'
import { THEMES, type ThemeName } from './theme/themes'
import type { ViewName } from './types'

const VIEW_TITLE: Record<ViewName, string> = {
  accounts: 'contas',
  git: 'git',
  diff: 'mudancas',
  history: 'historico',
  settings: 'ajustes',
}

export default function App() {
  const { theme, setTheme } = useTheme()
  const { prefs, set, toggleDock } = usePrefs()
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    notice,
    git,
    changes,
    accounts,
    setTabStatus,
    setTabActivity,
    tabActivity,
    switchAccount,
    openTab,
    closeTab,
    moveTab,
  } = useWorkspace()
  const [palette, setPalette] = useState(false)
  const [pickingFor, setPickingFor] = useState<'nova' | string | null>(null)
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

  // O terminal captura quase toda tecla, entao os atalhos do painel sao
  // ouvidos na fase de captura, antes de o xterm engolir o evento.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'b') {
        e.preventDefault()
        toggleDock()
      } else if (e.key === 'k') {
        e.preventDefault()
        setPalette((aberto) => !aberto)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [toggleDock])

  const commands: Command[] = useMemo(() => {
    const lista: Command[] = []

    for (const conta of accounts) {
      if (conta.active) continue
      lista.push({
        id: `conta-${conta.id}`,
        group: 'conta',
        label: `ativar ${conta.label}`,
        keywords: `trocar ${conta.id} ${conta.email ?? ''}`,
        hint: conta.tokenIssue ? 'sem token' : undefined,
        Icon: CMD_ICONS.Zap,
        run: () => switchAccount(conta.id),
      })
    }

    for (const aba of tabs) {
      if (aba.id === activeTabId) continue
      lista.push({
        id: `aba-${aba.id}`,
        group: 'aba',
        label: `ir para ${aba.title}`,
        keywords: aba.cwd,
        Icon: CMD_ICONS.Terminal,
        run: () => setActiveTabId(aba.id),
      })
    }

    lista.push(
      { id: 'aba-nova', group: 'aba', label: 'nova aba na mesma pasta', Icon: CMD_ICONS.Plus, run: () => openTab() },
      { id: 'aba-pasta', group: 'aba', label: 'abrir outra pasta em nova aba', keywords: 'projeto diretorio', Icon: CMD_ICONS.FolderOpen, run: () => setPickingFor('nova') },
      { id: 'aba-mover', group: 'aba', label: 'mover esta aba para outra pasta', keywords: 'projeto diretorio', Icon: CMD_ICONS.FolderSymlink, run: () => setPickingFor(activeTabId) },
      { id: 'aba-fechar', group: 'aba', label: 'fechar esta aba', Icon: CMD_ICONS.X, run: () => closeTab(activeTabId) },
      { id: 'ir-contas', group: 'ir para', label: 'contas', Icon: CMD_ICONS.Users, run: () => setView('accounts') },
      { id: 'ir-git', group: 'ir para', label: 'git', Icon: CMD_ICONS.GitBranch, run: () => setView('git') },
      { id: 'ir-diff', group: 'ir para', label: 'mudancas', Icon: CMD_ICONS.GitCompare, run: () => setView('diff') },
      { id: 'ir-ajustes', group: 'ir para', label: 'ajustes', Icon: CMD_ICONS.SlidersHorizontal, run: () => setView('settings') },
      { id: 'painel', group: 'painel', label: prefs.dockCollapsed ? 'expandir painel' : 'recolher painel', hint: 'cmd+B', Icon: CMD_ICONS.PanelRightClose, run: toggleDock },
      { id: 'anim', group: 'painel', label: prefs.animations ? 'desligar animacoes' : 'ligar animacoes', Icon: CMD_ICONS.SlidersHorizontal, run: () => set('animations', !prefs.animations) },
    )

    for (const nome of Object.keys(THEMES) as ThemeName[]) {
      if (nome === theme) continue
      lista.push({
        id: `tema-${nome}`,
        group: 'tema',
        label: nome,
        keywords: 'cor paleta',
        Icon: CMD_ICONS.Palette,
        run: () => setTheme(nome),
      })
    }

    return lista
  }, [accounts, tabs, activeTabId, prefs, theme, switchAccount, setActiveTabId, openTab, closeTab, toggleDock, set, setTheme])

  return (
    <div className="shell">
      <Sidebar
        view={view}
        onView={setView}
        badges={{ git: git?.files.length ?? 0, diff: changes?.files.length ?? 0 }}
      />

      <main className="main">
        <TabBar />
        <ProjectBar />
        <div className="panes">
          {tabs.map((tab) => (
            <ErrorBoundary key={tab.id} area={`terminal da aba ${tab.title}`}>
            <TerminalPane
              tab={tab}
              visible={tab.id === activeTabId}
              fontSize={prefs.terminalFontSize}
              lineHeight={prefs.terminalLineHeight}
              theme={theme}
              notice={notice}
              onStatus={setTabStatus}
              onActivity={setTabActivity}
            />
            </ErrorBoundary>
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
            <ErrorBoundary area={`painel de ${VIEW_TITLE[view]}`}>
              {view === 'accounts' && <AccountsView />}
              {view === 'git' && <GitView />}
              {view === 'diff' && <DiffView />}
              {view === 'history' && <HistoryView />}
              {view === 'settings' && (
                <SettingsView theme={theme} onTheme={setTheme} prefs={prefs} onPref={set} />
              )}
            </ErrorBoundary>
          )}
        </div>
      </aside>

      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}

      {pickingFor && (
        <FolderPicker
          onClose={() => setPickingFor(null)}
          onPick={(cwd) => {
            const alvo = pickingFor
            setPickingFor(null)
            if (alvo === 'nova') openTab(cwd)
            else if (alvo) moveTab(alvo, cwd)
          }}
        />
      )}

      <OfflineBanner />
      <StatusBar animations={prefs.animations} />
      <LimitToast />
    </div>
  )
}
