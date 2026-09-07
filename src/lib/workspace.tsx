import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  Account,
  AccountId,
  ChangesResult,
  GitState,
  TerminalTab,
} from '../types'
import type { PtyStatus } from './usePtySocket'
import { usePolling } from './usePolling'

export interface ServerInfo {
  defaultCwd: string
  claudeBin: string
  claudeVersion: string
}

export interface TerminalMessage {
  tabId: string | 'all'
  text: string
  seq: number
}

const FIRST_TAB: TerminalTab = { id: 'tab-1', title: 'terminal 1', cwd: '' }

/** Git e diff mudam a cada edicao; conta muda devagar. */
const GIT_POLL_MS = 4000
const CHANGES_POLL_MS = 4000
const ACCOUNTS_POLL_MS = 10_000

interface Workspace {
  accounts: Account[]
  activeAccountId: AccountId
  switching: boolean
  switchAccount: (id: AccountId) => void
  markRateLimited: () => void

  tabs: TerminalTab[]
  activeTabId: string
  activeTab: TerminalTab
  setActiveTabId: (id: string) => void
  openTab: () => void
  closeTab: (id: string) => void

  git: GitState | null
  gitError: string | null
  changes: ChangesResult | null
  changesError: string | null

  info: ServerInfo | null
  tabStatus: Record<string, PtyStatus>
  setTabStatus: (tabId: string, status: PtyStatus) => void

  notice: TerminalMessage | null
}

const WorkspaceContext = createContext<Workspace | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<TerminalTab[]>([FIRST_TAB])
  const [activeTabId, setActiveTabId] = useState(FIRST_TAB.id)
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [tabStatus, setTabStatusState] = useState<Record<string, PtyStatus>>({})
  const [notice, setNotice] = useState<TerminalMessage | null>(null)
  const [switching, setSwitching] = useState(false)
  const seqRef = useRef(0)
  const tabSeqRef = useRef(1)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
  const cwdParam = activeTab?.cwd ? `?cwd=${encodeURIComponent(activeTab.cwd)}` : ''

  const accountsPoll = usePolling<{ accounts: Account[]; activeId: AccountId }>(
    '/api/accounts',
    ACCOUNTS_POLL_MS,
  )
  const gitPoll = usePolling<GitState>(activeTab?.cwd ? `/api/git${cwdParam}` : null, GIT_POLL_MS)
  const changesPoll = usePolling<ChangesResult>(
    activeTab?.cwd ? `/api/changes${cwdParam}` : null,
    CHANGES_POLL_MS,
  )

  const accounts = accountsPoll.data?.accounts ?? []
  const activeAccountId = accountsPoll.data?.activeId ?? 1

  const emit = useCallback((text: string, tabId: string | 'all' = 'all') => {
    seqRef.current += 1
    setNotice({ tabId, text, seq: seqRef.current })
  }, [])

  // O cwd real de cada aba vem do servidor, nao de um caminho chutado no front.
  useEffect(() => {
    let alive = true
    fetch('/api/info')
      .then((r) => r.json())
      .then((data: ServerInfo) => {
        if (!alive) return
        setInfo(data)
        const name = data.defaultCwd.split(/[/\\]/).filter(Boolean).pop() ?? 'terminal'
        setTabs((prev) =>
          prev.map((t) => (t.cwd ? t : { ...t, cwd: data.defaultCwd, title: name })),
        )
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const setTabStatus = useCallback((tabId: string, status: PtyStatus) => {
    setTabStatusState((prev) => (prev[tabId] === status ? prev : { ...prev, [tabId]: status }))
  }, [])

  const switchAccount = useCallback(
    (id: AccountId) => {
      if (id === activeAccountId || switching) return
      const target = accounts.find((a) => a.id === id)
      setSwitching(true)
      emit(`ativando conta ${id}${target ? ` (${target.label})` : ''}`)

      fetch(`/api/accounts/${id}/activate`, { method: 'POST' })
        .then(() => accountsPoll.refresh())
        .then(() => {
          // O restart do processo com o token da conta entra na proxima fase.
          emit(
            `conta ${id} ativa. a partir daqui o consumo debita nela; o restart do processo com o token dela ainda nao esta ligado`,
          )
        })
        .catch((err) => emit(`falha ao trocar de conta: ${err}`))
        .finally(() => setSwitching(false))
    },
    [accounts, accountsPoll, activeAccountId, emit, switching],
  )

  const markRateLimited = useCallback(() => {
    fetch(`/api/accounts/${activeAccountId}/rate-limited`, { method: 'POST' })
      .then(() => accountsPoll.refresh())
      .catch(() => {})
  }, [accountsPoll, activeAccountId])

  const openTab = useCallback(() => {
    tabSeqRef.current += 1
    const id = `tab-${tabSeqRef.current}`
    setTabs((prev) => [
      ...prev,
      { id, title: `terminal ${tabSeqRef.current}`, cwd: info?.defaultCwd ?? '' },
    ])
    setActiveTabId(id)
  }, [info])

  const closeTab = useCallback((id: string) => {
    // Encerra tambem o processo no servidor, senao fica `claude` orfao.
    fetch(`/api/sessions/${id}`, { method: 'DELETE' }).catch(() => {})
    setTabs((prev) => {
      if (prev.length === 1) return prev
      const index = prev.findIndex((t) => t.id === id)
      const next = prev.filter((t) => t.id !== id)
      setActiveTabId((current) => (current === id ? next[Math.max(0, index - 1)].id : current))
      return next
    })
  }, [])

  const value = useMemo<Workspace>(
    () => ({
      accounts,
      activeAccountId,
      switching,
      switchAccount,
      markRateLimited,
      tabs,
      activeTabId,
      activeTab,
      setActiveTabId,
      openTab,
      closeTab,
      git: gitPoll.data,
      gitError: gitPoll.error,
      changes: changesPoll.data,
      changesError: changesPoll.error,
      info,
      tabStatus,
      setTabStatus,
      notice,
    }),
    [
      accounts,
      activeAccountId,
      switching,
      switchAccount,
      markRateLimited,
      tabs,
      activeTabId,
      activeTab,
      openTab,
      closeTab,
      gitPoll.data,
      gitPoll.error,
      changesPoll.data,
      changesPoll.error,
      info,
      tabStatus,
      setTabStatus,
      notice,
    ],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): Workspace {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace precisa estar dentro de WorkspaceProvider')
  return ctx
}
