import type { TerminalThemeMap } from './types'

// Buzz terminal palettes. Buzz is a stylesheet-driven skin (buzz-skin.css) with
// no ported ITheme, so its terminals had no matching colors — selecting Buzz
// left the terminal on whatever theme was set before. These two palettes make
// the terminal match Buzz's floating content card: the warm near-black canvas
// (#1a1a1a) in dark, the white card (#ffffff) in light. ANSI colors track the
// neutral GitHub-style hues Buzz's chrome already reads as.
export const BUZZ_TERMINAL_THEMES: TerminalThemeMap = {
  'Buzz Dark': {
    background: '#1A1A1A',
    foreground: '#E6EDF3',
    cursor: '#58A6FF',
    cursorAccent: '#1A1A1A',
    selectionBackground: '#58A6FF44',
    selectionForeground: '#E6EDF3',
    black: '#1A1A1A',
    red: '#F85149',
    green: '#3FB950',
    yellow: '#D29922',
    blue: '#58A6FF',
    magenta: '#BC8CFF',
    cyan: '#39C5CF',
    white: '#E6EDF3',
    brightBlack: '#E6EDF388',
    brightRed: '#F9746D',
    brightGreen: '#65C773',
    brightYellow: '#DBAD4E',
    brightBlue: '#79B8FF',
    brightMagenta: '#D2A8FF',
    brightCyan: '#56D4DD',
    brightWhite: '#E6EDF3'
  },
  'Buzz Light': {
    background: '#FFFFFF',
    foreground: '#1F2328',
    cursor: '#0969DA',
    cursorAccent: '#FFFFFF',
    selectionBackground: '#0969DA33',
    selectionForeground: '#1F2328',
    black: '#1F2328',
    red: '#CF222E',
    green: '#116329',
    yellow: '#4D2D00',
    blue: '#0969DA',
    magenta: '#8250DF',
    cyan: '#1B7C83',
    white: '#6E7781',
    brightBlack: '#1F232888',
    brightRed: '#A40E26',
    brightGreen: '#1A7F37',
    brightYellow: '#633C01',
    brightBlue: '#218BFF',
    brightMagenta: '#A475F9',
    brightCyan: '#3192AA',
    brightWhite: '#1F2328'
  }
}
