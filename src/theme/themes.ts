/**
 * Paletas portadas do Odysseus (odysseus-dev/odysseus, static/js/theme.js).
 * O design system inteiro dele se apoia em cinco tokens; mantive os mesmos
 * nomes para que a linguagem visual seja de fato a mesma, nao uma imitacao.
 */
export interface ThemeColors {
  bg: string
  fg: string
  panel: string
  border: string
  red: string
}

export const THEMES: Record<string, ThemeColors> = {
  original: { bg: '#282c34', fg: '#9cdef2', panel: '#111111', border: '#355a66', red: '#e06c75' },
  claude: { bg: '#262624', fg: '#f5f4f0', panel: '#30302e', border: '#4a4a47', red: '#c6613f' },
  midnight: { bg: '#0d1117', fg: '#c9d1d9', panel: '#161b22', border: '#30363d', red: '#f85149' },
  terminal: { bg: '#000000', fg: '#00ff41', panel: '#0a0a0a', border: '#003b00', red: '#00ff41' },
  cyberpunk: { bg: '#0a0a0f', fg: '#0ff0fc', panel: '#12101a', border: '#9b30ff', red: '#e040fb' },
  ocean: { bg: '#0b1a2c', fg: '#64d2ff', panel: '#091422', border: '#1e5074', red: '#4facfe' },
  copper: { bg: '#1c1410', fg: '#e8c39e', panel: '#140f0a', border: '#7a5533', red: '#d4764e' },
  organs: { bg: '#0a0406', fg: '#efe1c8', panel: '#15080a', border: '#3a1519', red: '#c83240' },
}

export type ThemeName = keyof typeof THEMES

export const DEFAULT_THEME: ThemeName = 'original'

/** Tema do xterm derivado dos tokens, para o terminal acompanhar a troca. */
export function xtermTheme(c: ThemeColors) {
  return {
    background: c.panel,
    foreground: c.fg,
    cursor: c.red,
    cursorAccent: c.panel,
    selectionBackground: `${c.border}80`,
    black: c.panel,
    brightBlack: '#828997',
    red: c.red,
    brightRed: c.red,
    green: '#50fa7b',
    brightGreen: '#50fa7b',
    yellow: '#e5c07b',
    brightYellow: '#f0ad4e',
    blue: '#61afef',
    brightBlue: '#61afef',
    magenta: '#c678dd',
    brightMagenta: '#c678dd',
    cyan: '#56b6c2',
    brightCyan: '#56b6c2',
    white: c.fg,
    brightWhite: '#ffffff',
  }
}
