import { useEffect, useRef, useState } from 'react'

/** Suaviza a chegada ao valor final: rapido no comeco, lento no fim. */
const easeOut = (t: number) => 1 - (1 - t) ** 3

/**
 * Anima um numero ate o valor novo em vez de trocar de uma vez. Um contador
 * que pula esconde a mudanca; um que sobe mostra que algo aconteceu.
 */
export function useCountUp(value: number, durationMs = 700): number {
  const [shown, setShown] = useState(value)
  const fromRef = useRef(value)
  const frameRef = useRef(0)

  useEffect(() => {
    const from = fromRef.current
    if (from === value) return

    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const current = from + (value - from) * easeOut(t)
      setShown(current)
      if (t < 1) frameRef.current = requestAnimationFrame(step)
      else fromRef.current = value
    }
    frameRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameRef.current)
  }, [value, durationMs])

  useEffect(() => {
    fromRef.current = shown
  }, [shown])

  return shown
}
