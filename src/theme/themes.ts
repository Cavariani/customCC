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
  // Laranja oficial do Claude.
  claude: { bg: '#262624', fg: '#f5f4f0', panel: '#30302e', border: '#4a4a47', red: '#d77757' },
  // Dracula oficial (draculatheme.com/spec): fundo #282a36, texto #f8f8f2,
  // vermelho #ff5555. O painel usa o #21222c da propria paleta, e a borda
  // o #44475a que o tema chama de "current line".
  dracula: { bg: '#282a36', fg: '#f8f8f2', panel: '#21222c', border: '#44475a', red: '#ff5555' },
  // Feito para este projeto, e nao portado: os outros tres sao um cinza-azul
  // frio, um cinza quente e um roxo — nenhum ocupa a faixa petroleo. O
  // acento vai para o ambar, que e a unica cor de destaque aqui que nao
  // disputa com o vermelho de erro.
  ambar: { bg: '#101719', fg: '#d6dcd8', panel: '#0a0f11', border: '#26383d', red: '#e0a244' },
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
