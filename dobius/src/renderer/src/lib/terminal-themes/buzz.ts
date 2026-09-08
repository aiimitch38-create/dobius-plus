import type { TerminalThemeMap } from './types'

// Buzz terminal palettes. Buzz is a stylesheet-driven skin (buzz-skin.css) with
// no ported ITheme, so its terminals had no matching colors. Canvas and text are
// taken straight from Buzz's own gradient stops (buzz-skin.css:15-16, 35-36) so
// the terminal reads as Buzz rather than as a neutral white/black pane: warm
// cream over deep navy in light, the inverse in dark. ANSI hues are warmed to
// sit on those canvases instead of on GitHub's neutral surfaces.
export const BUZZ_TERMINAL_THEMES: TerminalThemeMap = {
  'Buzz Dark': {
    background: '#0A1423',
    foreground: '#E6E6B6',
    cursor: '#C4D0DA',
    cursorAccent: '#0A1423',
    selectionBackground: '#C4D0DA44',
    selectionForeground: '#E6E6B6',
    black: '#0A1423',
    red: '#E86A5E',
    green: '#8FB96A',
    yellow: '#D9C05A',
    blue: '#7FA8CC',
    magenta: '#B98FC4',
    cyan: '#6FB5B5',
    white: '#E6E6B6',
    brightBlack: '#8A8452',
    brightRed: '#F58A7C',
    brightGreen: '#A9CE86',
    brightYellow: '#EBD87C',
    brightBlue: '#A3C4E0',
    brightMagenta: '#D2ADDA',
    brightCyan: '#93CFCF',
    brightWhite: '#F4F2DC'
  },
  'Buzz Light': {
    background: '#E6E6B6',
    foreground: '#0A1423',
    cursor: '#4A4616',
    cursorAccent: '#E6E6B6',
    selectionBackground: '#4A461633',
    selectionForeground: '#0A1423',
    black: '#0A1423',
    red: '#9B2C22',
    green: '#3D6023',
    yellow: '#6B5310',
    blue: '#1F4E79',
    magenta: '#6B3A78',
    cyan: '#1C5F5F',
    white: '#5A5A44',
    brightBlack: '#4A4616',
    brightRed: '#A32B1E',
    brightGreen: '#3F6321',
    brightYellow: '#70560E',
    brightBlue: '#2A6699',
    brightMagenta: '#8A4C9B',
    brightCyan: '#1B6262',
    brightWhite: '#0A1423'
  }
}
