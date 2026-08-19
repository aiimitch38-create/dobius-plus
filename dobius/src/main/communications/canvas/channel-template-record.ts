/**
 * Record shape and sanitization for channel templates (list_channel_templates/
 * create_channel_template/update_channel_template/delete_channel_template/
 * duplicate_channel_template — vendor call sites in
 * shared/api/tauriChannelTemplates.ts). A channel template is a saved
 * preset (name, description, channel type/visibility, an optional starter
 * canvas, and which personas/teams to auto-invite) for spinning up a new
 * channel quickly — purely local user preference data, not a relay concept,
 * so it is stored the same way team-store.ts stores teams: one JSON array
 * file in userData, never one file per record. That design point also
 * removes the path-traversal surface a per-record filename would create —
 * a template named `../../evil` is just a string in one JSON array, never
 * used to build a file path.
 *
 * Mirrors team-store.ts's own stance ("round-trips referenced agent ids
 * intact without validating them" — team-store.test.ts asserts this
 * directly): personaId/teamId here are structurally sanitized (must be a
 * non-empty string) but never checked against agents-store/team-store,
 * which this family does not own and must not import.
 */

export type ChannelTemplateBackend = { type: 'local' } | { type: 'provider'; id: string }

export type ChannelTemplateAgentEntry = {
  personaId: string
  runtime: string | null
  model: string | null
  role: string | null
  backend: ChannelTemplateBackend | null
}

export type ChannelTemplateTeamEntry = {
  teamId: string
  runtime: string | null
  model: string | null
  backend: ChannelTemplateBackend | null
}

export type ChannelTemplateAgents = {
  personas: ChannelTemplateAgentEntry[]
  teams: ChannelTemplateTeamEntry[]
}

export type ChannelTemplate = {
  id: string
  name: string
  description: string | null
  channelType: string
  visibility: string
  canvasTemplate: string | null
  agents: ChannelTemplateAgents
  createdAt: number
  updatedAt: number
}

export type ChannelTemplateInput = {
  name: string
  description?: string | null
  channelType?: string
  visibility?: string
  canvasTemplate?: string | null
  agents?: unknown
}

export type ChannelTemplateUpdate = Partial<Omit<ChannelTemplateInput, 'name'>> & { name?: string }

const CHANNEL_TYPES = new Set(['stream', 'forum'])
const VISIBILITIES = new Set(['open', 'private'])

export function assertValidTemplateName(name: string): void {
  if (!name.trim()) {
    throw new Error('Channel template name is required')
  }
}

export function normalizeChannelType(value: unknown, fallback = 'stream'): string {
  return typeof value === 'string' && CHANNEL_TYPES.has(value) ? value : fallback
}

export function normalizeVisibility(value: unknown, fallback = 'open'): string {
  return typeof value === 'string' && VISIBILITIES.has(value) ? value : fallback
}

export function normalizeCanvasTemplate(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeBackend(value: unknown): ChannelTemplateBackend | null {
  if (!value || typeof value !== 'object') {return null}
  const record = value as Record<string, unknown>
  if (record.type === 'local') {return { type: 'local' }}
  if (record.type === 'provider' && typeof record.id === 'string' && record.id.trim()) {
    return { type: 'provider', id: record.id.trim() }
  }
  return null
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizePersonaEntries(value: unknown): ChannelTemplateAgentEntry[] {
  if (!Array.isArray(value)) {return []}
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {return []}
    const record = entry as Record<string, unknown>
    const personaId = typeof record.personaId === 'string' ? record.personaId.trim() : ''
    if (!personaId) {return []}
    return [
      {
        personaId,
        runtime: normalizeOptionalString(record.runtime),
        model: normalizeOptionalString(record.model),
        role: normalizeOptionalString(record.role),
        backend: normalizeBackend(record.backend)
      }
    ]
  })
}

function normalizeTeamEntries(value: unknown): ChannelTemplateTeamEntry[] {
  if (!Array.isArray(value)) {return []}
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {return []}
    const record = entry as Record<string, unknown>
    const teamId = typeof record.teamId === 'string' ? record.teamId.trim() : ''
    if (!teamId) {return []}
    return [
      {
        teamId,
        runtime: normalizeOptionalString(record.runtime),
        model: normalizeOptionalString(record.model),
        backend: normalizeBackend(record.backend)
      }
    ]
  })
}

export function normalizeTemplateAgents(value: unknown): ChannelTemplateAgents {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return { personas: normalizePersonaEntries(input.personas), teams: normalizeTeamEntries(input.teams) }
}

function cloneAgents(agents: ChannelTemplateAgents): ChannelTemplateAgents {
  return {
    personas: agents.personas.map((persona) => ({ ...persona, backend: persona.backend ? { ...persona.backend } : null })),
    teams: agents.teams.map((team) => ({ ...team, backend: team.backend ? { ...team.backend } : null }))
  }
}

export function cloneChannelTemplate(template: ChannelTemplate): ChannelTemplate {
  return { ...template, agents: cloneAgents(template.agents) }
}

/** Reconstructs a `ChannelTemplate` from persisted (possibly stale/partial)
 * JSON — mirrors team-store.ts's `sanitize()` shape. Rows missing an id or
 * name are dropped rather than crashing app startup on a corrupted file. */
export function sanitizeChannelTemplateRow(raw: unknown): ChannelTemplate | null {
  if (!raw || typeof raw !== 'object') {return null}
  const record = raw as Partial<Record<keyof ChannelTemplate, unknown>>
  const id = typeof record.id === 'string' ? record.id : ''
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (!id || !name) {return null}
  return {
    id,
    name,
    description: normalizeOptionalString(record.description),
    channelType: normalizeChannelType(record.channelType),
    visibility: normalizeVisibility(record.visibility),
    canvasTemplate: normalizeCanvasTemplate(record.canvasTemplate),
    agents: normalizeTemplateAgents(record.agents),
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
  }
}
