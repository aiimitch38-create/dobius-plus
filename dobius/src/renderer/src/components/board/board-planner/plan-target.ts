import { PLAN_ROLES, type PlanBoardSnapshot } from './plan-schema'

// Target grammar shared by most plan steps: "all", an agent kind, a role, or an
// exact console/group name from board state. Never invents a name.

const EVERYONE = new Set([
  'all',
  'everyone',
  'everybody',
  'every console',
  'all consoles',
  'todos',
  'tous',
  'alle'
])

// Why: speech-to-text routinely mishears agent names; these map to the agent,
// never to unrelated words like cloud infrastructure.
const AGENT_ALIASES: Record<string, string> = {
  claude: 'claude',
  'claude code': 'claude',
  cloud: 'claude',
  'cloud code': 'claude',
  clawed: 'claude',
  clod: 'claude',
  claud: 'claude',
  codex: 'codex',
  codecs: 'codex',
  'code x': 'codex',
  kodex: 'codex',
  gemini: 'gemini',
  jiminy: 'gemini',
  gemeni: 'gemini',
  grok: 'grok',
  grock: 'grok',
  groq: 'grok',
  opencode: 'opencode',
  'open code': 'opencode'
}

export function normalizeTarget(raw: string): string {
  return raw.trim().replace(/^@/, '').replace(/\s+/g, ' ').toLowerCase()
}

/** Agent kind for a word as the user (or the recognizer) said it, or null. */
export function agentKindFor(word: string): string | null {
  return AGENT_ALIASES[normalizeTarget(word)] ?? null
}

export type ResolvedTarget =
  | { kind: 'consoles'; names: string[]; via: 'all' | 'agent' | 'role' | 'console' }
  | { kind: 'group'; name: string; members: string[] }

export function resolveTarget(raw: string, board: PlanBoardSnapshot): ResolvedTarget | null {
  const t = normalizeTarget(raw)
  if (!t) {
    return null
  }
  if (EVERYONE.has(t)) {
    return { kind: 'consoles', names: board.consoles.map((c) => c.name), via: 'all' }
  }
  const exactConsole = board.consoles.find((c) => c.name.toLowerCase() === t)
  if (exactConsole) {
    return { kind: 'consoles', names: [exactConsole.name], via: 'console' }
  }
  const group = board.groups.find((g) => g.name.toLowerCase() === t)
  if (group) {
    return { kind: 'group', name: group.name, members: group.members }
  }
  const agent = agentKindFor(t)
  if (agent) {
    const names = board.consoles.filter((c) => c.agent === agent).map((c) => c.name)
    return names.length > 0 ? { kind: 'consoles', names, via: 'agent' } : null
  }
  if ((PLAN_ROLES as readonly string[]).includes(t)) {
    const names = board.consoles.filter((c) => c.role === t).map((c) => c.name)
    return names.length > 0 ? { kind: 'consoles', names, via: 'role' } : null
  }
  // Orchestrator wiring accepts a comma list of console names.
  if (t.includes(',')) {
    const parts = t
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    const names = parts.flatMap((p) =>
      board.consoles.filter((c) => c.name.toLowerCase() === p).map((c) => c.name)
    )
    return names.length === parts.length ? { kind: 'consoles', names, via: 'console' } : null
  }
  return null
}

/**
 * "tell Claude 1 to run the tests" -> { target: "Claude 1", text: "run the tests" }.
 * Splits an addressee off a loop/order instruction so a named console or group
 * becomes the target instead of being read as part of a message to everyone.
 * The name is one to four words; null when the text addresses no one.
 */
export function splitAddressee(text: string): { target: string; text: string } | null {
  const m =
    text.match(
      /^(?:please\s+)?(?:tell|ask|have|get|make|remind|instruct)\s+((?:\S+\s+){0,3}?\S+?)\s*(?:\s+to\s+|:\s*|,\s*)(\S.*)$/i
    ) ?? text.match(/^@((?:\S+\s+){0,3}?\S+?)\s*[:,]\s*(\S.*)$/)
  if (!m) {
    return null
  }
  const target = m[1]
    .replace(/^the\s+/i, '')
    .replace(/\s+group$/i, '')
    .trim()
  const rest = m[2].trim()
  return target && rest ? { target, text: rest } : null
}

/** Console names a resolved target reaches. */
export function targetConsoleNames(target: ResolvedTarget): string[] {
  return target.kind === 'group' ? target.members : target.names
}

/** Closest console/group name for a near miss ("Reviwer 2" -> "Reviewer 2"), for the app's confirm. */
export function nearestName(raw: string, board: PlanBoardSnapshot): string | null {
  const names = [...board.consoles.map((c) => c.name), ...board.groups.map((g) => g.name)]
  return closestName(raw, names)?.name ?? null
}

/** Closest of `names` within a small edit distance of `raw`, with that distance. */
export function closestName(
  raw: string,
  names: readonly string[]
): { name: string; distance: number } | null {
  const t = normalizeTarget(raw)
  let best: { name: string; distance: number } | null = null
  for (const name of names) {
    const d = editDistance(t, name.toLowerCase())
    if (d <= Math.max(1, Math.floor(name.length / 4)) && (!best || d < best.distance)) {
      best = { name, distance: d }
    }
  }
  return best
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const up = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length]
}
