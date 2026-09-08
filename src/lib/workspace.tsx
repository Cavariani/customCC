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
  Quota,
  ChangesResult,
  GitState,
  TerminalTab,
} from '../types'
import type { Activity, PtyStatus } from './usePtySocket'
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
const TITLES_KEY = 'customcc-tab-titles'

/** Nomes que o Pedro deu as abas, guardados entre reloads. */
function storedTitles(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TITLES_KEY) ?? '{}')
  } catch {
    return {}
  }
}

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
  clearLimit: (id: AccountId) => void
  /** Trocar de conta sozinho quando a ativa bate o limite. */
  autoSwitch: boolean
  setAutoSwitch: (enabled: boolean) => void
  /** Cota real vinda do statusline; null enquanto o hook nao escrever. */
  quota: Quota | null
  /** Recarrega git e diff depois de uma escrita feita fora deste contexto. */
  refreshGit: () => void

  tabs: TerminalTab[]
  activeTabId: string
  activeTab: TerminalTab
  setActiveTabId: (id: string) => void
  openTab: (cwd?: string) => void
  closeTab: (id: string) => void
  renameTab: (id: string, title: string) => void

  git: GitState | null
  gitError: string | null
  /** Servidor local respondendo. Falso quando o poll comeca a falhar. */
  online: boolean
  stage: (paths: string[]) => Promise<void>
  unstage: (paths: string[]) => Promise<void>
  commit: (message: string, all: boolean) => Promise<{ hash: string; subject: string }>
  revert: (path: string) => Promise<string>
  /** Move a aba para outra pasta: o processo recomeca la. */
  moveTab: (id: string, cwd: string) => void
  changes: ChangesResult | null
  changesError: string | null

  info: ServerInfo | null
  tabStatus: Record<string, PtyStatus>
  setTabStatus: (tabId: string, status: PtyStatus) => void
  /** Em que pe cada aba esta: trabalhando, esperando voce, ou parada. */
  tabActivity: Record<string, Activity>
  setTabActivity: (tabId: string, state: Activity) => void

  notice: TerminalMessage | null
}

const WorkspaceContext = createContext<Workspace | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<TerminalTab[]>([FIRST_TAB])
  const [activeTabId, setActiveTabId] = useState(FIRST_TAB.id)
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [tabStatus, setTabStatusState] = useState<Record<string, PtyStatus>>({})
  const [tabActivity, setTabActivityState] = useState<Record<string, Activity>>({})
  const [notice, setNotice] = useState<TerminalMessage | null>(null)
  const [switching, setSwitching] = useState(false)
  const seqRef = useRef(0)
  const tabSeqRef = useRef(1)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
  const cwdParam = activeTab?.cwd ? `?cwd=${encodeURIComponent(activeTab.cwd)}` : ''

  const accountsPoll = usePolling<{ accounts: Account[]; activeId: AccountId; quota?: Quota }>(
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
  const quota = accountsPoll.data?.quota ?? null

  const emit = useCallback((text: string, tabId: string | 'all' = 'all') => {
    seqRef.current += 1
    setNotice({ tabId, text, seq: seqRef.current })
  }, [])

  // Na abertura, adota as sessoes que ja estao vivas no servidor. Sem isso o
  // reload mostrava uma aba so, e os outros processos `claude` seguiam
  // rodando invisiveis, gastando quota e sem jeito de voltar neles.
  useEffect(() => {
    let alive = true

    Promise.all([
      fetch('/api/info').then((r) => r.json() as Promise<ServerInfo>),
      fetch('/api/sessions')
        .then((r) => r.json() as Promise<{ sessions: { id: string; cwd: string; exited: boolean }[] }>)
        .catch(() => ({ sessions: [] })),
    ])
      .then(([data, live]) => {
        if (!alive) return
        setInfo(data)
        const titles = storedTitles()
        const nameOf = (cwd: string) => cwd.split(/[/\\]/).filter(Boolean).pop() ?? 'terminal'

        const restored = live.sessions
          .filter((s) => !s.exited)
          .map((s) => ({ id: s.id, cwd: s.cwd, title: titles[s.id] ?? nameOf(s.cwd) }))

        if (restored.length > 0) {
          setTabs(restored)
          setActiveTabId((current) =>
            restored.some((t) => t.id === current) ? current : restored[0].id,
          )
          // Continua a numeracao acima do maior id vivo, senao uma aba nova
          // reusaria o id de uma sessao existente e cairia dentro dela.
          tabSeqRef.current = restored.reduce((max, t) => {
            const n = Number(t.id.replace('tab-', ''))
            return Number.isFinite(n) ? Math.max(max, n) : max
          }, 0)
        } else {
          setTabs((prev) =>
            prev.map((t) =>
              t.cwd ? t : { ...t, cwd: data.defaultCwd, title: titles[t.id] ?? nameOf(data.defaultCwd) },
            ),
          )
        }
      })
      .catch(() => {})

    return () => {
      alive = false
    }
  }, [])

  const setTabStatus = useCallback((tabId: string, status: PtyStatus) => {
    setTabStatusState((prev) => (prev[tabId] === status ? prev : { ...prev, [tabId]: status }))
  }, [])

  const setTabActivity = useCallback((tabId: string, state: Activity) => {
    setTabActivityState((prev) => (prev[tabId] === state ? prev : { ...prev, [tabId]: state }))
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

  // A preferencia vive no servidor, e nao aqui: a troca acontece la e
  // precisa valer mesmo sem nenhuma aba aberta. O estado local e so um
  // espelho do que o servidor respondeu.
  const [autoSwitch, setAutoSwitchLocal] = useState(true)

  useEffect(() => {
    fetch('/api/auto-switch')
      .then((r) => r.json())
      .then((d) => setAutoSwitchLocal(d.enabled !== false))
      .catch(() => {})
  }, [])

  const setAutoSwitch = useCallback((enabled: boolean) => {
    // Move o interruptor na hora e corrige com a resposta: esperar a ida e
    // volta fazia o clique parecer perdido.
    setAutoSwitchLocal(enabled)
    fetch('/api/auto-switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
      .then((r) => r.json())
      .then((d) => setAutoSwitchLocal(d.enabled !== false))
      .catch(() => setAutoSwitchLocal(!enabled))
  }, [])

  const refreshGit = useCallback(() => {
    void Promise.all([gitPoll.refresh(), changesPoll.refresh()])
  }, [gitPoll, changesPoll])

  const markRateLimited = useCallback(() => {
    fetch(`/api/accounts/${activeAccountId}/rate-limited`, { method: 'POST' })
      .then(() => accountsPoll.refresh())
      .catch(() => {})
  }, [accountsPoll, activeAccountId])

  const post = useCallback(
    async (url: string, body: Record<string, unknown>) => {
      // O servidor recusa escrita sem cwd de proposito; avisar aqui evita
      // que o Pedro veja o erro cru de uma aba que ainda nao carregou.
      if (!activeTab?.cwd) throw new Error('a aba ainda nao sabe em que pasta esta')
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd: activeTab?.cwd, ...body }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
      return data
    },
    [activeTab],
  )

  const stage = useCallback(
    async (paths: string[]) => {
      await post('/api/git/stage', { paths })
      await gitPoll.refresh()
    },
    [post, gitPoll],
  )

  const unstage = useCallback(
    async (paths: string[]) => {
      await post('/api/git/unstage', { paths })
      await gitPoll.refresh()
    },
    [post, gitPoll],
  )

  const commit = useCallback(
    async (message: string, all: boolean) => {
      const result = await post('/api/git/commit', { message, all })
      await Promise.all([gitPoll.refresh(), changesPoll.refresh()])
      emit(`commit ${result.hash}: ${result.subject}`)
      return result as { hash: string; subject: string }
    },
    [post, gitPoll, changesPoll, emit],
  )

  const revert = useCallback(
    async (path: string) => {
      const result = await post('/api/changes/revert', { path })
      await Promise.all([gitPoll.refresh(), changesPoll.refresh()])
      emit(`revertido ${path} (${result.source})`)
      return result.source as string
    },
    [post, gitPoll, changesPoll, emit],
  )

  const moveTab = useCallback(
    (id: string, cwd: string) => {
      const name = cwd.split(/[/\\]/).filter(Boolean).pop() ?? 'terminal'
      fetch(`/api/sessions/${id}/cwd`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cwd }),
      })
        .then(() => {
          // O pty morreu; a aba remonta apontando para a pasta nova.
          setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, cwd, title: name } : t)))
        })
        .catch(() => {})
    },
    [],
  )

  const clearLimit = useCallback(
    (id: AccountId) => {
      fetch(`/api/accounts/${id}/clear-limit`, { method: 'POST' })
        .then(() => accountsPoll.refresh())
        .catch(() => {})
    },
    [accountsPoll],
  )

  const openTab = useCallback(
    (cwd?: string) => {
      tabSeqRef.current += 1
      const id = `tab-${tabSeqRef.current}`
      const folder = cwd ?? info?.defaultCwd ?? ''
      const name = folder.split(/[/\\]/).filter(Boolean).pop() ?? `terminal ${tabSeqRef.current}`
      setTabs((prev) => [...prev, { id, title: name, cwd: folder }])
      setActiveTabId(id)
    },
    [info],
  )

  const renameTab = useCallback((id: string, title: string) => {
    const clean = title.trim().slice(0, 40)
    if (!clean) return
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title: clean } : t)))
    // Sobrevive ao reload; a sessao do pty tambem sobrevive.
    try {
      const stored = JSON.parse(localStorage.getItem(TITLES_KEY) ?? '{}')
      localStorage.setItem(TITLES_KEY, JSON.stringify({ ...stored, [id]: clean }))
    } catch {
      /* storage indisponivel nao pode quebrar o rename */
    }
  }, [])

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
      clearLimit,
      autoSwitch,
      setAutoSwitch,
      quota,
      refreshGit,
      tabs,
      activeTabId,
      activeTab,
      setActiveTabId,
      openTab,
      closeTab,
      renameTab,
      git: gitPoll.data,
      gitError: gitPoll.error,
      online: accountsPoll.error === null,
      stage,
      unstage,
      commit,
      revert,
      moveTab,
      changes: changesPoll.data,
      changesError: changesPoll.error,
      info,
      tabStatus,
      setTabStatus,
      tabActivity,
      setTabActivity,
      notice,
    }),
    [
      accounts,
      activeAccountId,
      switching,
      switchAccount,
      markRateLimited,
      clearLimit,
      autoSwitch,
      setAutoSwitch,
      quota,
      refreshGit,
      tabs,
      activeTabId,
      activeTab,
      openTab,
      closeTab,
      renameTab,
      gitPoll.data,
      gitPoll.error,
      accountsPoll.error,
      stage,
      unstage,
      commit,
      revert,
      moveTab,
      changesPoll.data,
      changesPoll.error,
      info,
      tabStatus,
      setTabStatus,
      tabActivity,
      setTabActivity,
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
