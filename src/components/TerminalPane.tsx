import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { THEMES, xtermTheme, type ThemeName } from '../theme/themes'
import { usePtySocket, type Activity, type PtyStatus } from '../lib/usePtySocket'
import type { TerminalTab } from '../types'
import type { TerminalMessage } from '../lib/workspace'
import '@xterm/xterm/css/xterm.css'

interface Props {
  tab: TerminalTab
  visible: boolean
  fontSize: number
  theme: ThemeName
  notice: TerminalMessage | null
  onStatus: (tabId: string, status: PtyStatus) => void
  onActivity: (tabId: string, state: Activity) => void
}

/**
 * Um xterm por aba, ligado a uma sessao de pty no servidor. O componente
 * nunca desmonta ao trocar de aba, so fica escondido, senao o scrollback se
 * perde. O processo `claude` vive no backend e sobrevive a reloads.
 */
export function TerminalPane({
  tab,
  visible,
  fontSize,
  theme,
  notice,
  onStatus,
  onActivity,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const lastSeqRef = useRef(0)
  const [ready, setReady] = useState(false)

  const getTerm = useCallback(() => termRef.current, [])
  const report = useCallback((state: Activity) => onActivity(tab.id, state), [onActivity, tab.id])
  const { status } = usePtySocket({
    sessionId: tab.id,
    cwd: tab.cwd,
    getTerm,
    enabled: ready,
    onActivity: report,
  })

  useEffect(() => {
    onStatus(tab.id, status)
  }, [status, tab.id, onStatus])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: "'Fira Code', ui-monospace, Menlo, monospace",
      fontSize,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 10_000,
      allowProposedApi: true,
      theme: xtermTheme(THEMES[theme]),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)

    // O renderer WebGL desenha os caracteres de bloco e de moldura como
    // geometria do tamanho exato da celula. O renderer DOM, que e o padrao,
    // desenha como texto: o glifo cobre so a caixa em da fonte e, com
    // lineHeight 1.45, sobra faixa vazia entre as linhas — era isso que
    // fatiava o mascote do Claude Code em tiras.
    // Sem WebGL2 o addon lanca de dentro do proprio activate, fora do
    // alcance deste try, e a excecao derruba o painel inteiro. Perguntar
    // antes custa um canvas descartavel e evita a tela cinza.
    const temWebgl = (() => {
      try {
        return !!document.createElement('canvas').getContext('webgl2')
      } catch {
        return false
      }
    })()

    let webgl: WebglAddon | null = null
    try {
      if (!temWebgl) throw new Error('sem contexto webgl2')
      const addon = new WebglAddon()
      // loadAddon primeiro: o onContextLoss so existe depois que o addon e
      // ativado. Registrar antes lia o renderer ainda indefinido e lancava
      // "Cannot read properties of undefined (reading '_isDisposed')", que
      // derrubava o TerminalPane e levava a tela inteira junto.
      term.loadAddon(addon)
      // Contexto de WebGL pode ser perdido (memoria de video, aba dormindo).
      // Sem soltar o addon aqui o terminal congela em vez de voltar para o
      // renderer DOM.
      addon.onContextLoss(() => {
        addon.dispose()
        webgl = null
      })
      webgl = addon
    } catch (error) {
      // Sem WebGL o terminal continua funcionando no renderer DOM; so os
      // blocos voltam a ficar fatiados.
      console.warn('[customcc] WebGL indisponivel, usando o renderer DOM:', error)
      webgl = null
    }

    fit.fit()
    termRef.current = term
    fitRef.current = fit
    setReady(true)

    const observer = new ResizeObserver(() => {
      if (container.clientWidth > 0 && container.clientHeight > 0) fit.fit()
    })
    observer.observe(container)

    return () => {
      setReady(false)
      observer.disconnect()
      webgl?.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // O terminal e criado uma vez por aba; tema e avisos vem nos efeitos abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A aba mudou de pasta: o processo antigo morreu, entao a tela dele nao
  // pode continuar ali por baixo do processo novo.
  const cwdRef = useRef(tab.cwd)
  useEffect(() => {
    if (cwdRef.current === tab.cwd) return
    cwdRef.current = tab.cwd
    termRef.current?.reset()
  }, [tab.cwd])

  // Corpo da fonte mudou: refaz o calculo de colunas com o novo tamanho.
  useEffect(() => {
    const term = termRef.current
    if (!term || term.options.fontSize === fontSize) return
    term.options.fontSize = fontSize
    fitRef.current?.fit()
  }, [fontSize])

  // Tema trocado: repinta sem recriar o terminal, preservando o scrollback.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme(THEMES[theme])
  }, [theme])

  // Ficou visivel: refaz o fit, que nao roda direito com o container oculto.
  useEffect(() => {
    if (visible && containerRef.current?.clientWidth) {
      fitRef.current?.fit()
      termRef.current?.focus()
    }
  }, [visible])

  // Aviso da casca (troca de conta, limite atingido) escrito dentro do pty.
  useEffect(() => {
    const term = termRef.current
    if (!term || !notice || notice.seq === lastSeqRef.current) return
    if (notice.tabId !== 'all' && notice.tabId !== tab.id) return
    lastSeqRef.current = notice.seq
    term.writeln(`\r\n\x1b[38;2;224;108;117m::\x1b[0m ${notice.text}`)
  }, [notice, tab.id])

  return (
    <div className="pane" hidden={!visible}>
      <div className="pane__surface" ref={containerRef} />
    </div>
  )
}
