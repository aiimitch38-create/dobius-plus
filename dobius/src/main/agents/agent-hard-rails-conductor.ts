import { stringsToInspect } from './agent-hard-rails-inputs'

// Voice Conductor profile only (BUILD-033). The conductor runs with Bash and
// Dobius's Full Disk Access / Automation grants, so without these rails it can
// read its own approval code from chat.db and "reply" through Messages, or swap
// the dobius-confirm script. Best-effort against a shell-capable agent: the
// durable fix is the SDK sandbox denying ~/Library/Messages.

export const CONDUCTOR_MESSAGING_REASON =
  'Hard rail: the Voice Conductor may not read Messages, drive AppleScript, open SQLite databases or change the dobius-* CLIs.'

const DOBIUS_CLI_NAMES =
  '(?:confirm|ask|send|tabs|reply|track|status|mark-done|spawn|lead-tab|asana-[a-z-]+|task-done|stage|handoff|scheduled)'

const BASH_DENY_PATTERNS: readonly RegExp[] = [
  /(^|[^\w-])osascript(?![\w-])/i,
  /(^|[^\w-])sqlite3(?![\w-])/i,
  /Library\/+Messages/i,
  /chat\.db(?![\w-])/i,
  /\.local\/+bin\/+dobius-/i,
  new RegExp(`(?:/|>\\s*)dobius-${DOBIUS_CLI_NAMES}(?![\\w-])`, 'i'),
  new RegExp(
    `(^|[^\\w-])(?:tee|cp|mv|ln|install|chmod|chown|rm|touch|sed|perl|python3?|node|ruby)(?![\\w-])[^;&|\\n]*(^|[^\\w-])dobius-${DOBIUS_CLI_NAMES}(?![\\w-])`,
    'i'
  )
]

const PATH_DENY_PATTERNS: readonly RegExp[] = [
  /Library\/+Messages/i,
  /chat\.db(?![\w-])/i,
  new RegExp(`(^|/)dobius-${DOBIUS_CLI_NAMES}$`, 'i')
]

// Why: quotes and backslashes are dropped the way the shell would, so
// `osa"script"` or `Library/Mess\ages` can't slip past a plain text match.
function unquoted(value: string): string {
  return value.replace(/["'\\]/g, '').replace(/\/{2,}/g, '/')
}

export type ConductorRailContext = {
  // Run profile id (agent-runner-dobius-tools.ts).
  profile?: string
}

export function conductorProfileDenial(
  context: ConductorRailContext,
  toolName: string,
  input: unknown
): { reason: string } | null {
  if (context.profile !== 'voice-conductor') {
    return null
  }
  const strings = stringsToInspect(toolName, input).map(({ raw }) => unquoted(raw))
  const patterns = toolName === 'Bash' ? BASH_DENY_PATTERNS : PATH_DENY_PATTERNS
  if (strings.some((value) => patterns.some((pattern) => pattern.test(value)))) {
    return { reason: CONDUCTOR_MESSAGING_REASON }
  }
  return null
}
