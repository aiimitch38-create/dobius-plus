import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const FILE_NAME = 'teams.json'

// Why: mirrors the Buzz "team" concept (a named group of agents you can
// message) — see vendor/buzz-desktop/src/shared/api/types.ts AgentTeam.
// Dobius's own custom agents (agents-store.ts) are the persona pool a team
// references by id; a team never owns or clones agent records.
//
// accountIds: which Dobius-connected Claude/Codex accounts (the `id` from
// ClaudeManagedAccountSummary/CodexManagedAccountSummary in shared/types.ts
// — a randomUUID(), never a credential) back this team's agents. HARD RULE:
// this field, and every function below that touches it, may only ever hold
// that opaque account id — never an access token, refresh token, or any
// other secret. normalizeAccountIds() enforces that at the boundary; see
// isTokenShapedCandidate()'s doc for what it rejects and why.
export type Team = {
  id: string
  name: string
  description: string | null
  instructions: string | null
  personaIds: string[]
  accountIds: string[]
  createdAt: number
  updatedAt: number
}

export type TeamInput = {
  name: string
  description?: string | null
  instructions?: string | null
  personaIds?: string[]
  accountIds?: string[]
}

export type TeamUpdate = Partial<Omit<TeamInput, 'name'>> & {
  name?: string
}

let cached: Team[] | null = null

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function cloneTeam(team: Team): Team {
  return { ...team, personaIds: [...team.personaIds], accountIds: [...team.accountIds] }
}

function normalizePersonaIds(ids: string[] | undefined): string[] {
  const normalized = ids?.filter((id) => typeof id === 'string' && id.trim()) ?? []
  return [...new Set(normalized)]
}

// Why: a real Dobius account id (see the Team.accountIds doc above) is an
// opaque randomUUID() — short, no delimiters that carry meaning. A pasted
// credential looks structurally different: OAuth/API tokens run long,
// contain '.'-delimited JWT segments, or carry a recognizable secret prefix
// ('sk-', 'Bearer '). This is defense-in-depth, not the only guard — no code
// path in this file ever reads token material off ClaudeAccountService/
// CodexAccountService to begin with — but it means a caller-side mistake
// (e.g. accidentally passing a token instead of an id) gets dropped here
// rather than silently persisted to disk.
function isTokenShapedCandidate(value: string): boolean {
  if (value.length > 128) {
    return true
  }
  if (/^(sk-|bearer\s)/i.test(value)) {
    return true
  }
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    return true
  }
  return false
}

function normalizeAccountIds(ids: string[] | undefined): string[] {
  const normalized =
    ids?.filter((id) => typeof id === 'string' && id.trim() && !isTokenShapedCandidate(id.trim())) ?? []
  return [...new Set(normalized)]
}

function sanitize(raw: unknown): Team[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const record = entry as Partial<Record<keyof Team, unknown>>
    const id = typeof record.id === 'string' ? record.id : ''
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!id || !name) {
      return []
    }
    return [
      {
        id,
        name,
        description: typeof record.description === 'string' ? record.description : null,
        instructions: typeof record.instructions === 'string' ? record.instructions : null,
        personaIds: normalizePersonaIds(
          Array.isArray(record.personaIds) ? (record.personaIds as string[]) : undefined
        ),
        accountIds: normalizeAccountIds(
          Array.isArray(record.accountIds) ? (record.accountIds as string[]) : undefined
        ),
        createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
      }
    ]
  })
}

function load(): Team[] {
  if (cached) {
    return cached
  }
  try {
    cached = sanitize(JSON.parse(readFileSync(filePath(), 'utf-8')))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      console.warn(
        '[teams] failed to load teams:',
        error instanceof Error ? error.message : String(error)
      )
    }
    cached = []
  }
  return cached
}

function persist(teams: Team[]): void {
  const target = filePath()
  const tmp = `${target}.${process.pid}.tmp`
  try {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(tmp, `${JSON.stringify(teams, null, 2)}\n`, 'utf-8')
    renameSync(tmp, target)
  } catch (error) {
    console.warn(
      '[teams] failed to persist teams:',
      error instanceof Error ? error.message : String(error)
    )
  }
}

function assertValidName(name: string): void {
  if (!name.trim()) {
    throw new Error('Team name is required')
  }
}

export function listTeams(): Team[] {
  return load().map(cloneTeam)
}

export function getTeam(id: string): Team | null {
  const team = load().find((entry) => entry.id === id)
  return team ? cloneTeam(team) : null
}

export function createTeam(input: TeamInput): Team[] {
  const name = input.name.trim()
  assertValidName(name)
  const now = Date.now()
  const teams = load()
  teams.push({
    id: randomUUID(),
    name,
    description: input.description?.trim() || null,
    instructions: input.instructions?.trim() || null,
    personaIds: normalizePersonaIds(input.personaIds),
    accountIds: normalizeAccountIds(input.accountIds),
    createdAt: now,
    updatedAt: now
  })
  cached = teams
  persist(teams)
  return listTeams()
}

export function updateTeam(id: string, updates: TeamUpdate): Team[] {
  const teams = load()
  const team = teams.find((entry) => entry.id === id)
  if (!team) {
    throw new Error('Team not found')
  }
  if (updates.name !== undefined) {
    assertValidName(updates.name)
    team.name = updates.name.trim()
  }
  if (updates.description !== undefined) {
    team.description = updates.description?.trim() || null
  }
  if (updates.instructions !== undefined) {
    team.instructions = updates.instructions?.trim() || null
  }
  if (updates.personaIds !== undefined) {
    team.personaIds = normalizePersonaIds(updates.personaIds)
  }
  if (updates.accountIds !== undefined) {
    team.accountIds = normalizeAccountIds(updates.accountIds)
  }
  team.updatedAt = Date.now()
  cached = teams
  persist(teams)
  return listTeams()
}

// Why: a team is only a named reference to Dobius custom agents by id —
// deleting it must never touch the agents-store records it points at.
export function removeTeam(id: string): Team[] {
  cached = load().filter((team) => team.id !== id)
  persist(cached)
  return listTeams()
}
