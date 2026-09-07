import { useEffect, useRef, useState } from 'react'

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&*+=<>[]{}/\\_-'

/** Quadro a cada 22ms: rapido o bastante para nao atrasar a leitura. */
const FRAME_MS = 22
/** Quadros que cada caractere passa embaralhado antes de assentar. */
const HOLD = 2
/** Teto de duracao. Texto longo nao pode ficar ilegivel por segundos. */
const MAX_MS = 450

interface Options {
  /** Desligado, o texto troca direto, sem embaralhar. */
  enabled?: boolean
  /** Rodada extra de embaralho mesmo com o texto igual. */
  trigger?: unknown
  /**
   * Nao embaralha na primeira renderizacao. Sem isso, so abrir o painel ja
   * mostrava os nomes das contas ilegiveis, como se estivessem corrompidos.
   */
  skipFirst?: boolean
}

/**
 * Revela o texto da esquerda para a direita, com os caracteres ainda nao
 * assentados trocando por glifos aleatorios. Usado quando o painel troca de
 * conta: o dado vem de outra secao, e a animacao mostra isso em vez de o
 * texto simplesmente pular.
 */
export function useScramble(
  value: string,
  { enabled = true, trigger, skipFirst = false }: Options = {},
) {
  const [shown, setShown] = useState(value)
  const frameRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const primeira = useRef(true)

  useEffect(() => {
    const daPrimeiraVez = primeira.current
    primeira.current = false
    if (!enabled || (skipFirst && daPrimeiraVez)) {
      setShown(value)
      return
    }

    frameRef.current = 0
    // O teto encurta o passo quando o texto e longo, em vez de deixar a
    // animacao esticar proporcionalmente ao numero de letras.
    const passos = value.length * HOLD + HOLD
    const total = Math.min(passos, Math.floor(MAX_MS / FRAME_MS))
    const porQuadro = Math.max(1, Math.ceil(value.length / Math.max(1, total)))

    const tick = () => {
      const frame = frameRef.current++
      // Cada caractere assenta HOLD quadros depois do anterior.
      const settled = Math.floor(frame * porQuadro)
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
  }, [value, enabled, trigger, skipFirst])

  return shown
}
