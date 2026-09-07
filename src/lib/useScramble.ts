import { useEffect, useRef, useState } from 'react'

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&*+=<>[]{}/\\_-'

/** Quadro a cada 28ms: rapido o bastante para nao atrasar a leitura. */
const FRAME_MS = 28
/** Quadros que cada caractere passa embaralhado antes de assentar. */
const HOLD = 3

interface Options {
  /** Desligado, o texto troca direto, sem embaralhar. */
  enabled?: boolean
  /** Rodada extra de embaralho mesmo com o texto igual. */
  trigger?: unknown
}

/**
 * Revela o texto da esquerda para a direita, com os caracteres ainda nao
 * assentados trocando por glifos aleatorios. Usado quando o painel troca de
 * conta: o dado vem de outra secao, e a animacao mostra isso em vez de o
 * texto simplesmente pular.
 */
export function useScramble(value: string, { enabled = true, trigger }: Options = {}) {
  const [shown, setShown] = useState(value)
  const frameRef = useRef(0)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) {
      setShown(value)
      return
    }

    frameRef.current = 0
    const total = value.length * HOLD + HOLD

    const tick = () => {
      const frame = frameRef.current++
      // Cada caractere assenta HOLD quadros depois do anterior.
      const settled = Math.floor(frame / HOLD)
      let out = ''
      for (let i = 0; i < value.length; i++) {
        const char = value[i]
        if (i < settled || char === ' ') out += char
        else out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      }
      setShown(out)
      if (frame < total) timerRef.current = window.setTimeout(tick, FRAME_MS)
      else setShown(value)
    }

    tick()
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [value, enabled, trigger])

  return shown
}
