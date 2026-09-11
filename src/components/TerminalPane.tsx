import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { THEMES, xtermTheme, type ThemeName } from '../theme/themes'
import { usePtySocket, type Activity, type PtyStatus } from '../lib/usePtySocket'
import type { TerminalTab } from '../types'
import type { TerminalMessage } from '../lib/workspace'
import { copiarTexto, enviarImagem, imagensDe, lerTexto } from '../lib/areaDeTransferencia'
import '@xterm/xterm/css/xterm.css'

interface Props {
  tab: TerminalTab
  visible: boolean
  fontSize: number
  lineHeight: number
  theme: ThemeName
  /** Copiar sozinho o que for selecionado com o mouse. */
  copiarAoSelecionar: boolean
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
  lineHeight,
  theme,
  copiarAoSelecionar,
  notice,
  onStatus,
  onActivity,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const lastSeqRef = useRef(0)
  const [ready, setReady] = useState(false)
  // Aviso curto de "copiado" / "imagem anexada". Dizer que deu certo importa
  // aqui: copiar do terminal nao muda nada na tela, entao sem retorno a
  // duvida e se a tecla funcionou.
  const [aviso, setAviso] = useState<string | null>(null)
  const [anexos, setAnexos] = useState<{ arquivo: string; caminho: string }[]>([])
  const [arrastandoImagem, setArrastandoImagem] = useState(false)

  const getTerm = useCallback(() => termRef.current, [])
  const report = useCallback(
    (state: Activity) => {
      // Comecou a trabalhar: o prompt partiu, e as miniaturas descreviam
      // justamente o que foi junto com ele.
      if (state === 'working') setAnexos((prev) => (prev.length ? [] : prev))
      onActivity(tab.id, state)
    },
    [onActivity, tab.id],
  )
  const { status, send } = usePtySocket({
    sessionId: tab.id,
    cwd: tab.cwd,
    resumeId: tab.resumeId,
    getTerm,
    enabled: ready,
    onActivity: report,
  })

  useEffect(() => {
    onStatus(tab.id, status)
  }, [status, tab.id, onStatus])

  // O terminal e montado uma unica vez, com dependencias vazias, entao tudo
  // que ele precisa e que muda depois entra por ref: fechar sobre o valor
  // da primeira renderizacao deixaria o atalho preso na preferencia antiga.
  const sendRef = useRef(send)
  sendRef.current = send
  const selecionarCopiaRef = useRef(copiarAoSelecionar)
  selecionarCopiaRef.current = copiarAoSelecionar

  const piscar = useCallback((texto: string) => {
    setAviso(texto)
    window.setTimeout(() => setAviso((atual) => (atual === texto ? null : atual)), 1400)
  }, [])

  /** Salva a imagem e escreve o caminho no prompt do `claude`. */
  const anexarImagens = useCallback(
    async (arquivos: File[]) => {
      for (const arquivo of arquivos) {
        try {
          const salvo = await enviarImagem(arquivo)
          // O caminho entra no prompt seguido de espaco: o `claude` le a
          // imagem do disco, e a miniatura aqui em cima e o preview que o
          // alt+v nunca deu.
          sendRef.current(`${salvo.caminho} `)
          setAnexos((prev) => [...prev.slice(-5), salvo])
          piscar('imagem anexada')
        } catch (erro) {
          piscar(`falhou: ${erro instanceof Error ? erro.message : erro}`)
        }
      }
    },
    [piscar],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: "'Fira Code', ui-monospace, Menlo, monospace",
      fontSize,
      lineHeight,
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

    /**
     * Teclas que a casca resolve antes do terminal.
     *
     * shift+enter: o xterm manda CR, que para o `claude` e "enviar". A
     * quebra de linha que ele entende e ESC+CR — a mesma sequencia que o
     * `/terminal-setup` grava no iTerm2 e no VS Code.
     *
     * ctrl+c: so vira copiar quando ha selecao. Sem selecao continua sendo
     * a interrupcao, que e o uso mais frequente da tecla num terminal e
     * nao pode ser sequestrado.
     */
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey

      if (e.key === 'Enter' && e.shiftKey && !mod && !e.altKey) {
        sendRef.current('\x1b\r')
        return false
      }

      if (mod && (e.key === 'c' || e.key === 'C') && (term.hasSelection() || e.shiftKey)) {
        const texto = term.getSelection()
        if (!texto) return !e.shiftKey
        void copiarTexto(texto).then((ok) => piscar(ok ? 'copiado' : 'nao deu para copiar'))
        term.clearSelection()
        return false
      }

      // ctrl+shift+v e o colar de terminal; o ctrl+v continua indo para o
      // xterm, que ja trata o evento de colar do navegador sozinho.
      if (mod && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        void lerTexto().then((texto) => {
          if (texto) sendRef.current(texto)
        })
        return false
      }

      return true
    })

    // Selecionar com o mouse ja copia, como num terminal de verdade. Copiar
    // a cada mudanca da selecao encheria a area de transferencia de
    // fragmentos durante o arrasto, entao o gatilho e soltar o botao.
    const aoSoltar = () => {
      if (!selecionarCopiaRef.current) return
      const texto = term.getSelection()
      if (!texto.trim()) return
      void copiarTexto(texto).then((ok) => {
        if (ok) piscar('copiado')
      })
    }
    container.addEventListener('mouseup', aoSoltar)

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
      container.removeEventListener('mouseup', aoSoltar)
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

  // Entrelinha: mesmo caminho do corpo da fonte, para o ajuste valer sem
  // recriar o terminal e perder o que esta na tela.
  useEffect(() => {
    const term = termRef.current
    if (!term || term.options.lineHeight === lineHeight) return
    term.options.lineHeight = lineHeight
    fitRef.current?.fit()
  }, [lineHeight])

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
    <div
      className={`pane${arrastandoImagem ? ' is-dropping' : ''}`}
      hidden={!visible}
      // Colar e arrastar sao ouvidos na fase de captura, antes do xterm:
      // imagem nos tratamos aqui, e texto segue para o terminal intacto.
      onPasteCapture={(e) => {
        const imagens = imagensDe(e.clipboardData)
        if (imagens.length === 0) return
        e.preventDefault()
        void anexarImagens(imagens)
      }}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setArrastandoImagem(true)
      }}
      onDragLeave={(e) => {
        // O dragleave dispara tambem ao passar por cima de um filho; so a
        // saida real da area interessa.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setArrastandoImagem(false)
      }}
      onDrop={(e) => {
        const imagens = imagensDe(e.dataTransfer)
        setArrastandoImagem(false)
        if (imagens.length === 0) return
        e.preventDefault()
        void anexarImagens(imagens)
      }}
    >
      <div className="pane__surface" ref={containerRef} />

      {anexos.length > 0 && (
        <div className="anexos" aria-label="imagens anexadas a esta mensagem">
          {anexos.map((anexo) => (
            <figure key={anexo.arquivo} className="anexos__item" title={anexo.caminho}>
              <img src={`/api/anexos/${anexo.arquivo}`} alt={anexo.arquivo} />
              <button
                type="button"
                className="anexos__x"
                aria-label="tirar esta miniatura"
                // Tira so a miniatura: o caminho ja foi escrito no prompt, e
                // apagar texto que o Pedro talvez tenha editado seria pior.
                onClick={() => setAnexos((prev) => prev.filter((a) => a.arquivo !== anexo.arquivo))}
              >
                <X size={10} strokeWidth={2.4} />
              </button>
            </figure>
          ))}
        </div>
      )}

      {arrastandoImagem && (
        <div className="pane__solte">
          <ImagePlus size={18} strokeWidth={1.8} />
          solte a imagem
        </div>
      )}

      {aviso && <div className="pane__aviso">{aviso}</div>}
    </div>
  )
}
