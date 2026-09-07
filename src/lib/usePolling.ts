import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Busca um endpoint em intervalo fixo. Pausa quando a aba do navegador esta
 * em segundo plano, para nao ficar batendo no git a cada 3s a toa.
 */
export function usePolling<T>(url: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (!url || inFlight.current) return
    inFlight.current = true
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setData((await response.json()) as T)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      inFlight.current = false
    }
  }, [url])

  useEffect(() => {
    if (!url) return
    void refresh()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [url, intervalMs, refresh])

  return { data, error, refresh }
}
