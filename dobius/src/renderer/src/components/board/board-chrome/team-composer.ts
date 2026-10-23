import type { TuiAgent } from '../../../../../shared/types'

// Team composer rules (pure): up to 12 slots, each a role plus an agent; a
// role pre-selects its default agent from the user's saved map, then the
// built-in map, then whatever is enabled.

export const TEAM_MAX_SLOTS = 12

// Role ids match the planner's roles, so "@reviewers" style targets reach them.
export const TEAM_ROLES = [
  'general',
  'frontend',
  'backend',
  'tests',
  'review',
  'design',
  'docs',
  'security'
] as const
export type TeamRole = (typeof TEAM_ROLES)[number]

export type TeamSlot = { role: TeamRole; agent: TuiAgent }
export type RoleAgentMap = Partial<Record<TeamRole, TuiAgent>>

// Why: builders default to Claude; reviewers default to Codex for a second
// model's eyes on the work. Only used when that agent is enabled.
export const BUILT_IN_ROLE_AGENTS: RoleAgentMap = { review: 'codex' }
const BUILDER_DEFAULT: TuiAgent = 'claude'

export const TEAM_ROLE_AGENTS_STORAGE_KEY = 'dobius.board.teamRoleAgents'

export function defaultAgentForRole(
  role: TeamRole,
  available: readonly TuiAgent[],
  saved: RoleAgentMap
): TuiAgent | null {
  const candidates = [saved[role], BUILT_IN_ROLE_AGENTS[role], BUILDER_DEFAULT, available[0]]
  return candidates.find((a): a is TuiAgent => a !== undefined && available.includes(a)) ?? null
}

export function initialTeam(
  count: number,
  available: readonly TuiAgent[],
  saved: RoleAgentMap
): TeamSlot[] {
  const agent = defaultAgentForRole('general', available, saved)
  if (!agent) {
    return []
  }
  const n = Math.min(TEAM_MAX_SLOTS, Math.max(1, Math.floor(count)))
  return Array.from({ length: n }, () => ({ role: 'general' as const, agent }))
}

/** Changing a slot's role re-picks that role's default agent. */
export function setSlotRole(
  slots: readonly TeamSlot[],
  index: number,
  role: TeamRole,
  available: readonly TuiAgent[],
  saved: RoleAgentMap
): TeamSlot[] {
  return slots.map((slot, i) =>
    i === index ? { role, agent: defaultAgentForRole(role, available, saved) ?? slot.agent } : slot
  )
}

export function setSlotAgent(
  slots: readonly TeamSlot[],
  index: number,
  agent: TuiAgent
): TeamSlot[] {
  return slots.map((slot, i) => (i === index ? { ...slot, agent } : slot))
}

/** Adds a slot copying the last one's role (and its default agent); capped at 12. */
export function addSlot(
  slots: readonly TeamSlot[],
  available: readonly TuiAgent[],
  saved: RoleAgentMap
): TeamSlot[] {
  if (slots.length >= TEAM_MAX_SLOTS) {
    return [...slots]
  }
  const role = slots.at(-1)?.role ?? 'general'
  const agent = defaultAgentForRole(role, available, saved)
  return agent ? [...slots, { role, agent }] : [...slots]
}

/** Sets every slot to `agent`, keeping each slot's role (the "Fill all" row). */
export function fillAllSlots(slots: readonly TeamSlot[], agent: TuiAgent): TeamSlot[] {
  return slots.map((slot) => ({ ...slot, agent }))
}

/** Grows (copying the last slot's role) or trims the team to `count`, clamped to 1–12. */
export function resizeTeam(
  slots: readonly TeamSlot[],
  count: number,
  available: readonly TuiAgent[],
  saved: RoleAgentMap
): TeamSlot[] {
  if (slots.length === 0 || !Number.isFinite(count)) {
    return [...slots]
  }
  const target = Math.min(TEAM_MAX_SLOTS, Math.max(1, Math.floor(count)))
  let next = slots.slice(0, target)
  while (next.length < target) {
    const grown = addSlot(next, available, saved)
    if (grown.length === next.length) {
      break
    }
    next = grown
  }
  return next
}

export const TEAM_NAME_MAX_CHARS = 60

/** The group name typed in the composer, or null to keep the default "Group N". */
export function teamGroupName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, TEAM_NAME_MAX_CHARS).trim()
  return name.length > 0 ? name : null
}

/** Removes a slot but never the last one. */
export function removeSlot(slots: readonly TeamSlot[], index: number): TeamSlot[] {
  return slots.length <= 1 ? [...slots] : slots.filter((_, i) => i !== index)
}

/** The saved map with each role's chosen agent remembered (last slot of a role wins). */
export function rememberRoleAgents(saved: RoleAgentMap, slots: readonly TeamSlot[]): RoleAgentMap {
  const next: RoleAgentMap = { ...saved }
  for (const slot of slots) {
    next[slot.role] = slot.agent
  }
  return next
}

export function parseRoleAgentMap(
  raw: string | null,
  isAgent: (value: string) => value is TuiAgent
): RoleAgentMap {
  if (!raw) {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {}
  }
  const map: RoleAgentMap = {}
  for (const role of TEAM_ROLES) {
    const value = (parsed as Record<string, unknown>)[role]
    if (typeof value === 'string' && isAgent(value)) {
      map[role] = value
    }
  }
  return map
}
