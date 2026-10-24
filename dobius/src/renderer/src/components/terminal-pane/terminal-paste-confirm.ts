import type { TerminalPasteSource, TerminalPasteTextOptions } from './terminal-paste-model'

// Paste-as-commands safety: a multi-line paste into a plain shell runs every
// line as a command. Before that happens the user confirms (Paste / Paste as
// one line / Cancel). A terminal in bracketed-paste mode (Claude Code, Codex,
// modern shells' line editors) receives the paste as one block and decides
// itself, so no dialog is shown there.

export type TerminalPasteConfirmReason = {
  lineCount: number
  /** Short label of a risky command found in the text, or null. */
  risky: string | null
}

const USER_PASTE_SOURCES: ReadonlySet<TerminalPasteSource> = new Set([
  'keyboard',
  'paste-event',
  'app-menu',
  'context-menu',
  'right-click',
  'middle-click'
])

const RISKY_COMMANDS: { label: string; re: RegExp }[] = [
  { label: 'rm -r', re: /(^|[\s;&|])rm\s+(-\w*[rRf]\w*\s+)+/ },
  { label: 'sudo', re: /(^|[\s;&|])sudo\s/ },
  { label: 'git push --force', re: /\bgit\s+push\b[^\n]*\s(-f|--force)(\s|$)/ },
  { label: 'git reset --hard', re: /\bgit\s+reset\s+--hard\b/ },
  { label: 'git clean', re: /\bgit\s+clean\s+-\w*f/ },
  { label: 'curl | sh', re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/ },
  { label: 'mkfs', re: /(^|[\s;&|])mkfs(\.\w+)?\s/ },
  { label: 'dd', re: /(^|[\s;&|])dd\s+[^\n]*\bof=/ },
  { label: 'chmod -R', re: /\bch(mod|own)\s+-R\b/ },
  { label: 'drop table', re: /\bdrop\s+(table|database)\b/i },
  { label: 'shutdown', re: /(^|[\s;&|])(shutdown|reboot|halt)(\s|$)/ },
  { label: ':(){', re: /:\(\)\s*\{/ }
]

function contentLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '')
}

export function riskyPasteCommand(text: string): string | null {
  return RISKY_COMMANDS.find(({ re }) => re.test(text))?.label ?? null
}

/** Why the paste needs a confirmation, or null to paste straight away. */
export function terminalPasteConfirmReason(input: {
  text: string
  source: TerminalPasteSource
  /** The terminal asked for bracketed paste (DECSET 2004); the app handles multi-line input. */
  bracketedPasteMode: boolean
  /** Settings toggle; undefined means on. */
  enabled: boolean | undefined
  options?: TerminalPasteTextOptions
}): TerminalPasteConfirmReason | null {
  if (input.enabled === false || input.bracketedPasteMode) {
    return null
  }
  // Generated image paths and programmatic pastes are not user clipboard text.
  if (!USER_PASTE_SOURCES.has(input.source) || input.options?.forceBracketedPaste) {
    return null
  }
  const lineCount = contentLines(input.text).length
  const risky = riskyPasteCommand(input.text)
  return lineCount >= 2 || risky ? { lineCount: Math.max(1, lineCount), risky } : null
}

/** Joins the pasted lines with spaces so nothing runs until the user presses Enter. */
export function pasteAsOneLine(text: string): string {
  return contentLines(text)
    .map((line) => line.trim())
    .join(' ')
}
