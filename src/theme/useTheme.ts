import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_THEME, THEMES, type ThemeName } from './themes'

const LS_KEY = 'customcc-theme'

function applyColors(name: ThemeName) {
  const colors = THEMES[name]
  const root = document.documentElement
  root.style.setProperty('--bg', colors.bg)
  root.style.setProperty('--fg', colors.fg)
  root.style.setProperty('--panel', colors.panel)
  root.style.setProperty('--border', colors.border)
  root.style.setProperty('--red', colors.red)
  root.dataset.theme = name
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const stored = localStorage.getItem(LS_KEY)
    return stored && stored in THEMES ? (stored as ThemeName) : DEFAULT_THEME
  })

  useEffect(() => {
    applyColors(theme)
    localStorage.setItem(LS_KEY, theme)
  }, [theme])

  const setTheme = useCallback((name: ThemeName) => setThemeState(name), [])
  return { theme, setTheme }
}
