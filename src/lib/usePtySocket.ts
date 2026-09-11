import { useCallback, useEffect, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'

export type PtyStatus = 'connecting' | 'live' | 'exited' | 'error'

export type Activity = 'working' | 'waiting' | 'idle'

interface ServerMessage {
  t: 'ready' | 'data' | 'exit' | 'activity'
  state?: Activity
  data?: string
  code?: number
  pid?: number
  cwd?: string
  replay?: string
  reattached?: boolean
}

interface Options {
  sessionId: string
  cwd: string
  /** Conversa a retomar ao nascer, quando a aba veio da lista. */
  resumeId?: string
  /** Recebe o estado da sessao lido do output. */
  onActivity: (state: Activity) => void
  /** Terminal ja montado; o hook so liga os dois lados. */
  getTerm: () => Terminal | null
  enabled: boolean
}

/**
 * Liga um xterm a uma sessao de pty no servidor. O processo `claude` vive no
 * backend e sobrevive a reloads: ao reconectar, o servidor repoe o output.
 */
export function usePtySocket({ sessionId, cwd, resumeId, getTerm, enabled, onActivity }: Options) {
  const [status, setStatus] = useState<PtyStatus>('connecting')
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!enabled) return
    const term = getTerm()
    if (!term) return

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const params = new URLSearchParams({
      session: sessionId,
      cwd,
      cols: String(term.cols),
      rows: String(term.rows),
    })
    // So na primeira conexao: numa reconexao o processo ja existe e o
    // servidor ignora o parametro, mas mandar de novo confundiria a leitura.
    if (resumeId) params.set('resume', resumeId)
    const socket = new WebSocket(`${proto}://${location.host}/pty?${params}`)
    socketRef.current = socket

    socket.onmessage = (event) => {
      const msg: ServerMessage = JSON.parse(event.data)
      if (msg.t === 'ready') {
        setStatus('live')
        if (msg.replay) term.write(msg.replay)
        // Sincroniza o tamanho na reconexao. O pty sobrevive ao reload, e
        // sem isto ele guarda as dimensoes de quando foi criado: abrir a
        // mesma sessao numa janela maior deixava o `claude` desenhando na
        // largura antiga. O primeiro fit acontece antes deste socket
        // existir, entao o evento de resize dele nao seria ouvido.
        socket.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }))
      } else if (msg.t === 'data') {
        term.write(msg.data ?? '')
      } else if (msg.t === 'activity') {
        if (msg.state) onActivity(msg.state)
      } else if (msg.t === 'exit') {
        setStatus('exited')
        term.writeln(`\r\n\x1b[38;2;130;137;151mprocesso encerrado (${msg.code})\x1b[0m`)
      }
    }
    socket.onerror = () => setStatus('error')
    socket.onclose = () => setStatus((s) => (s === 'exited' ? s : 'error'))

    const sub = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: 'input', data }))
      }
    })

    const resizeSub = term.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: 'resize', cols, rows }))
      }
    })

    return () => {
      sub.dispose()
      resizeSub.dispose()
      socket.close()
      socketRef.current = null
    }
  }, [sessionId, cwd, enabled, getTerm, onActivity])

  /**
   * Escreve no pty sem passar pelo xterm. Existe para as teclas que a casca
   * intercepta antes do terminal — shift+enter, por exemplo, que precisa
   * virar ESC+CR em vez do CR que enviaria a mensagem.
   */
  const send = useCallback((data: string) => {
    const socket = socketRef.current
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ t: 'input', data }))
      return true
    }
    return false
  }, [])

  return { status, send }
}
