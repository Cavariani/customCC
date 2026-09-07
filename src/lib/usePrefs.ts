import { useCallback, useEffect, useState } from 'react'

export interface Prefs {
  /** Painel de contas recolhido na largura do rail. */
  dockCollapsed: boolean
  density: 'compacta' | 'confortavel'
  animations: boolean
  grain: boolean
  /** Corpo da fonte do terminal, em px. */
  terminalFontSize: number
}

const KEY = 'customcc-prefs'

const DEFAULTS: Prefs = {
  dockCollapsed: false,
  density: 'confortavel',
  animations: true,
  grain: true,
  terminalFontSize: 12.5,
}

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

/** Preferencias visuais, aplicadas como atributos no root para o CSS ler. */
export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(load)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.density = prefs.density
    root.dataset.animations = String(prefs.animations)
    root.dataset.grain = String(prefs.grain)
    root.dataset.dock = prefs.dockCollapsed ? 'collapsed' : 'open'
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs))
    } catch {
      /* storage indisponivel nao pode quebrar a preferencia */
    }
  }, [prefs])

  const set = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((prev) => ({ ...prev, [key]: value }))
  }, [])

  const toggleDock = useCallback(() => {
    setPrefs((prev) => ({ ...prev, dockCollapsed: !prev.dockCollapsed }))
  }, [])

  return { prefs, set, toggleDock }
}
