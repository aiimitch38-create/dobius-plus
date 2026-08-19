/**
 * Backs export_team_snapshot / encode_team_snapshot_for_send /
 * preview_team_snapshot_import / confirm_team_snapshot_import
 * (vendor/buzz-desktop/src/shared/api/tauriTeams.ts). Reads team-store.ts
 * through its public API only (listTeams/getTeam/createTeam) — never edits
 * that file or writes teams.json directly, per the multi-agent build split
 * (another agent owns team-store.ts).
 *
 * A team snapshot embeds one member entry per team.personaIds — each
 * member entry is the same field set agent-snapshot.ts uses
 * (parseAgentEnvelopeFields), just without its own magic/version wrapper,
 * so both import paths validate member data identically.
 */
import { getAgent } from '../../agents/agents-store'
import type { CustomAgent } from '../../../shared/agents'
import { createTeam, getTeam, type Team } from '../team-store'
import {
  decodeEnvelopeBytes,
  encodeEnvelope,
  readBoundedString,
  type SnapshotFormat,
  type SnapshotMemoryLevel
} from './snapshot-codec'
import { createAgentFromEnvelope, parseAgentEnvelopeFields, type AgentSnapshotEnvelope } from './agent-snapshot'

export const TEAM_SNAPSHOT_MAGIC = 'buzz-team-snapshot'

type TeamSnapshotMemberEnvelope = Omit<AgentSnapshotEnvelope, 'magic' | 'version'>

/**
 * One raw member entry's parse outcome. A single malformed member (e.g. a
 * blank display name) must not take down the whole team import — see
 * confirmTeamSnapshotImport's partial-success contract below — so member
 * parsing is per-entry and fault-tolerant rather than all-or-nothing like
 * the outer envelope decode.
 */
type ParsedMember =
  | { ok: true; envelope: TeamSnapshotMemberEnvelope }
  | { ok: false; reason: string; rawDisplayName: string }

/** The envelope this module BUILDS for export — a plain array of member fields. */
export type TeamSnapshotEnvelope = {
  magic: typeof TEAM_SNAPSHOT_MAGIC
  version: 1
  name: string
  description: string | null
  instructions: string | null
  members: TeamSnapshotMemberEnvelope[]
}

/** The envelope this module DECODES on import — each member's own parse outcome, never all-or-nothing. */
type ParsedTeamSnapshotEnvelope = {
  magic: typeof TEAM_SNAPSHOT_MAGIC
  version: 1
  name: string
  description: string | null
  instructions: string | null
  members: ParsedMember[]
}

function memberEnvelope(agent: CustomAgent): TeamSnapshotMemberEnvelope {
  return {
    displayName: agent.name,
    systemPrompt: agent.systemPrompt || null,
    model: agent.model || null,
    runtime: agent.engine ?? 'claude',
    accountId: null,
    avatarUrl: null,
    respondToAllowlist: [],
    memoryLevel: 'none'
  }
}

function teamToEnvelope(team: Team): TeamSnapshotEnvelope {
  const members = team.personaIds
    .map((id) => getAgent(id))
    .filter((agent): agent is CustomAgent => agent !== null)
    .map(memberEnvelope)
  return {
    magic: TEAM_SNAPSHOT_MAGIC,
    version: 1,
    name: team.name,
    description: team.description,
    instructions: team.instructions,
    members
  }
}

export type ExportTeamSnapshotInput = {
  id: string
  memoryLevel: SnapshotMemoryLevel
  format: SnapshotFormat
}

/** Opens a native save dialog and writes the snapshot; returns false if the user cancels. */
export async function exportTeamSnapshot(input: ExportTeamSnapshotInput): Promise<boolean> {
  const team = getTeam(input.id)
  if (!team) {
    throw new Error(`Team not found: ${input.id}`)
  }
  const bytes = encodeEnvelope(teamToEnvelope(team), input.format, null)
  const { dialog } = await import('electron')
  const extension = input.format === 'png' ? 'png' : 'team.json'
  const safeName = team.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'team'
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export team snapshot',
    defaultPath: `${safeName}.${extension}`,
    filters:
      input.format === 'png'
        ? [{ name: 'Team snapshot image', extensions: ['png'] }]
        : [{ name: 'Team snapshot', extensions: ['json'] }]
  })
  if (canceled || !filePath) {
    return false
  }
  const { writeFile } = await import('node:fs/promises')
  await writeFile(filePath, bytes)
  return true
}

export type EncodedTeamSnapshot = { fileBytes: number[]; fileName: string }

export function encodeTeamSnapshotForSend(input: ExportTeamSnapshotInput): EncodedTeamSnapshot {
  const team = getTeam(input.id)
  if (!team) {
    throw new Error(`Team not found: ${input.id}`)
  }
  const bytes = encodeEnvelope(teamToEnvelope(team), input.format, null)
  const safeName = team.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'team'
  const extension = input.format === 'png' ? 'png' : 'team.json'
  return { fileBytes: Array.from(bytes), fileName: `${safeName}.${extension}` }
}

export type TeamSnapshotMemberPreview = {
  displayName: string
  systemPrompt: string | null
  avatarUrl: string | null
  hasSourceAllowlist: boolean
  sourceAllowlistCount: number
}

export type TeamSnapshotImportPreview = {
  name: string
  description: string | null
  instructions: string | null
  members: TeamSnapshotMemberPreview[]
  hasSourceAllowlist: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeTeamEnvelope(fileBytes: number[]): ParsedTeamSnapshotEnvelope {
  const decoded = decodeEnvelopeBytes(Uint8Array.from(fileBytes), TEAM_SNAPSHOT_MAGIC)
  if (!decoded.ok) {
    throw new Error(decoded.reason)
  }
  const raw = decoded.value
  const name = readBoundedString(raw.name) ?? ''
  if (!name.trim()) {
    throw new Error('Team snapshot is missing a name')
  }
  const rawMembers = Array.isArray(raw.members) ? raw.members : []
  // Why a cap independent of MAX_SNAPSHOT_ARRAY_LENGTH: a team with
  // thousands of "members" is not a real team, it's an attempt to make
  // import do thousands of agent-creation writes from one file.
  const MAX_TEAM_MEMBERS = 200
  const members: ParsedMember[] = rawMembers
    .slice(0, MAX_TEAM_MEMBERS)
    .filter(isPlainObject)
    .map((member) => {
      try {
        return { ok: true, envelope: parseAgentEnvelopeFields(member) }
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
          rawDisplayName: readBoundedString(member.displayName) ?? ''
        }
      }
    })
  return {
    magic: TEAM_SNAPSHOT_MAGIC,
    version: 1,
    name: name.trim(),
    description: readBoundedString(raw.description),
    instructions: readBoundedString(raw.instructions),
    members
  }
}

export function previewTeamSnapshotImport(fileBytes: number[]): TeamSnapshotImportPreview {
  const envelope = decodeTeamEnvelope(fileBytes)
  // Why filter rather than surface parse failures here: preview is a
  // read-only "here's what would import" view — a malformed member entry
  // just doesn't show up, the same way it won't become an agent on confirm.
  // confirmTeamSnapshotImport is where a failed member is reported (it has
  // actually attempted, and failed, to create something).
  const members = envelope.members
    .filter((member): member is Extract<ParsedMember, { ok: true }> => member.ok)
    .map((member) => ({
      displayName: member.envelope.displayName,
      systemPrompt: member.envelope.systemPrompt,
      avatarUrl: member.envelope.avatarUrl,
      hasSourceAllowlist: member.envelope.respondToAllowlist.length > 0,
      sourceAllowlistCount: member.envelope.respondToAllowlist.length
    }))
  return {
    name: envelope.name,
    description: envelope.description,
    instructions: envelope.instructions,
    members,
    hasSourceAllowlist: members.some((member) => member.hasSourceAllowlist)
  }
}

export type TeamSnapshotImportMemberResult = {
  displayName: string
  pubkey: string
  personaId: string
  memoryWritten: number
  memoryTotal: number
  memoryErrors: string[]
  profileSyncError: string | null
}

export type TeamSnapshotImportResult = {
  team: Team
  personaIds: string[]
  members: TeamSnapshotImportMemberResult[]
}

export type ConfirmTeamSnapshotImportInput = {
  fileBytes: number[]
  keepAllowlist: boolean
}

/**
 * Imports a team snapshot: creates one brand-new agent per member (via
 * agent-snapshot.ts's createAgentFromEnvelope, so member import can never
 * drift from single-agent import), then creates the team referencing their
 * new ids. If a later member fails to create, the team is still created
 * with whichever members succeeded — matching the honest partial-success
 * contract TeamSnapshotImportMemberResult's per-member memoryErrors implies
 * (a whole-import rollback is not part of that contract).
 */
export function confirmTeamSnapshotImport(input: ConfirmTeamSnapshotImportInput): TeamSnapshotImportResult {
  const envelope = decodeTeamEnvelope(input.fileBytes)
  const members: TeamSnapshotImportMemberResult[] = []
  const personaIds: string[] = []
  for (const parsedMember of envelope.members) {
    if (!parsedMember.ok) {
      members.push({
        displayName: parsedMember.rawDisplayName,
        pubkey: '',
        personaId: '',
        memoryWritten: 0,
        memoryTotal: 0,
        memoryErrors: [parsedMember.reason],
        profileSyncError: null
      })
      continue
    }
    const fullEnvelope: AgentSnapshotEnvelope = { magic: 'buzz-agent-snapshot', version: 1, ...parsedMember.envelope }
    try {
      const { agent, newPubkey } = createAgentFromEnvelope(fullEnvelope, input.keepAllowlist)
      personaIds.push(agent.id)
      members.push({
        displayName: agent.name,
        pubkey: newPubkey,
        personaId: agent.id,
        memoryWritten: 0,
        memoryTotal: 0,
        memoryErrors: [],
        profileSyncError: null
      })
    } catch (error) {
      members.push({
        displayName: parsedMember.envelope.displayName,
        pubkey: '',
        personaId: '',
        memoryWritten: 0,
        memoryTotal: 0,
        memoryErrors: [error instanceof Error ? error.message : String(error)],
        profileSyncError: null
      })
    }
  }
  const createdTeams = createTeam({
    name: envelope.name,
    description: envelope.description,
    instructions: envelope.instructions,
    personaIds
  })
  const team = createdTeams.at(-1)
  if (!team) {
    throw new Error('Failed to create team from snapshot')
  }
  return { team, personaIds, members }
}
