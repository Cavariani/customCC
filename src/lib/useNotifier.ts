import { useEffect, useRef } from 'react'
import type { Activity } from './usePtySocket'
import type { TerminalTab } from '../types'

/**
 * Avisa quando uma aba passa a esperar por voce, ou quando termina o que
 * estava fazendo. Só notifica se a janela nao estiver em foco, ou se a aba
 * avisada nao for a que voce esta olhando: notificar o que ja esta na sua
 * frente e so barulho.
 */
export function useNotifier(
  tabs: TerminalTab[],
  activity: Record<string, Activity>,
  activeTabId: string,
  enabled: boolean,
) {
  const previous = useRef<Record<string, Activity>>({})

  useEffect(() => {
    const antes = previous.current
    previous.current = { ...activity }
    if (!enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return
    }

    for (const tab of tabs) {
      const de = antes[tab.id]
      const para = activity[tab.id]
      if (!de || de === para) continue
      // A aba que voce esta olhando, com a janela em foco, nao precisa de aviso.
      if (tab.id === activeTabId && document.hasFocus()) continue

      if (para === 'waiting') {
        notificar(`${tab.title} espera por voce`, 'o Claude parou pedindo permissao')
      } else if (de === 'working' && para === 'idle') {
        notificar(`${tab.title} terminou`, tab.cwd)
      }
    }
  }, [tabs, activity, activeTabId, enabled])
}

function notificar(titulo: string, corpo: string) {
  try {
    const n = new Notification(titulo, { body: corpo, silent: false })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    /* navegador pode recusar; um aviso perdido nao pode quebrar a app */
  }
}

/** Pede a permissao do navegador, sempre a partir de um clique. */
export async function pedirPermissaoDeAviso(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied'
  if (Notification.permission !== 'default') return Notification.permission
  return Notification.requestPermission()
}
