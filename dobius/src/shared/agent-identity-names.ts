// Agent display-name rules shared by the CLI (--as / DOBIUS_AGENT_NAME) and main.

export const AGENT_ID_FLAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
export const AGENT_DISPLAY_NAME_PATTERN = /^[A-Za-z0-9 ._-]{1,32}$/

/** Names an agent may never wear: the human, the app, and system voices. */
export const RESERVED_AGENT_NAMES: ReadonlySet<string> = new Set(['carson', 'system', 'dobius', 'you'])

/**
 * Reserved when the name, lowercased and stripped of everything but letters,
 * STARTS WITH a reserved word: "Carson.", "Carson 2", "Dobius AI", "You-" and
 * "SYSTEM" are all refused.
 */
export function isReservedAgentName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z]/g, '')
  for (const reserved of RESERVED_AGENT_NAMES) {
    if (normalized.startsWith(reserved)) {
      return true
    }
  }
  return false
}

export function isValidAgentDisplayName(name: string): boolean {
  return AGENT_DISPLAY_NAME_PATTERN.test(name) && !isReservedAgentName(name)
}
