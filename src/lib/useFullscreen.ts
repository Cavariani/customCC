import { useCallback, useEffect, useState } from 'react'

/**
 * Tela cheia da janela inteira.
 *
 * O estado sai do documento, e nao de um booleano nosso, porque o botao nao e
 * o unico caminho: o usuario entra com F11 e sai com Esc sem passar por aqui.
 * Guardando estado proprio, o icone passaria a mentir na primeira vez que isso
 * acontecesse.
 */

// O Safari do macOS ainda so tem a versao com prefixo, e o projeto nasceu la.
interface DocumentoWebkit {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void>
}

interface ElementoWebkit {
  webkitRequestFullscreen?: () => Promise<void>
}

export function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const doc = document as Document & DocumentoWebkit
    const sincroniza = () =>
      setFullscreen(Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement))

    // Uma leitura antes de ouvir: a pagina pode recarregar ja em tela cheia.
    sincroniza()
    const eventos = ['fullscreenchange', 'webkitfullscreenchange']
    for (const evento of eventos) document.addEventListener(evento, sincroniza)
    return () => {
      for (const evento of eventos) document.removeEventListener(evento, sincroniza)
    }
  }, [])

  const toggle = useCallback(() => {
    const doc = document as Document & DocumentoWebkit
    const raiz = document.documentElement as HTMLElement & ElementoWebkit
    const ativo = document.fullscreenElement ?? doc.webkitFullscreenElement

    const acao = ativo
      ? (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())
      : (raiz.requestFullscreen?.() ?? raiz.webkitRequestFullscreen?.())

    // O navegador recusa o pedido fora de gesto do usuario ou quando a
    // permission policy proibe, e a recusa chega como promessa rejeitada. Sem
    // o catch ela sobe como unhandled rejection e polui o console; o
    // fullscreenchange simplesmente nao vem e o icone fica como estava.
    Promise.resolve(acao).catch(() => {})
  }, [])

  return { fullscreen, toggle }
}
