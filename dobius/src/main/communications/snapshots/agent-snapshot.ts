/**
 * Backs export_agent_snapshot / encode_agent_snapshot_for_send /
 * preview_agent_snapshot_import / confirm_agent_snapshot_import
 * (vendor/buzz-desktop/src/shared/api/tauriPersonas.ts). Reads/writes
 * through src/main/agents/agents-store.ts's public API only — this module
 * never touches agents.json directly, matching the "don't reimplement
 * storage" rule from the build brief.
 *
 * HONEST SCOPE — memory: Buzz's persona snapshot carries recorded agent
 * "memory" entries (memoryLevel/memoryEntryCount, and export's
 * memorySourcePubkey param). Dobius's CustomAgent (src/shared/agents.ts)
 * has no equivalent per-agent memory store — there is nothing to read. Every
 * export/preview here echoes the REQUESTED memoryLevel back (so the UI's
 * "Export with memory: none/core/everything" selector round-trips) but
 * memoryEntryCount/memoryWritten/memoryTotal are always 0, never fabricated
 * placeholder counts. See the build report's RISKS section.
 *
 * HONEST SCOPE — pubkey: a Buzz agent's `newPubkey` is a real Nostr signing
 * key (src/main/communications/agent-participant-identity-store.ts owns
 * deriving those, and that module is outside this task's scope/ownership).
 * Newly imported agents here get a random 32-byte hex identifier that has
 * the right shape for the wire contract but is NOT a signing key — it
 * cannot be used to send/verify anything. Flagged in the build report.
 */
import { randomBytes } from 'node:crypto'
import { getAgent, createAgent, listAgents } from '../../agents/agents-store'
import type { CustomAgent } from '../../../shared/agents'
import {
  decodeEnvelopeBytes,
  encodeEnvelope,
  parsePngDataUrl,
  readBoundedString,
  readBoundedStringArray,
  type SnapshotFormat,
  type SnapshotMemoryLevel
} from './snapshot-codec'
import { safeAccountIdOrNull } from './snapshot-secrets'

export const AGENT_SNAPSHOT_MAGIC = 'buzz-agent-snapshot'

export type AgentSnapshotEnvelope = {
  magic: typeof AGENT_SNAPSHOT_MAGIC
  version: 1
  displayName: string
  systemPrompt: string | null
  model: string | null
  runtime: string | null
  accountId: string | null
  avatarUrl: string | null
  respondToAllowlist: string[]
  memoryLevel: SnapshotMemoryLevel
}

function agentToEnvelope(agent: CustomAgent, memoryLevel: SnapshotMemoryLevel): AgentSnapshotEnvelope {
  return {
    magic: AGENT_SNAPSHOT_MAGIC,
    version: 1,
    displayName: agent.name,
    systemPrompt: agent.systemPrompt || null,
    model: agent.model || null,
    runtime: agent.engine ?? 'claude',
    accountId: safeAccountIdOrNull(agent.accountId),
    avatarUrl: null,
    respondToAllowlist: [],
    memoryLevel
  }
}

function buildEnvelopeBytes(
  agent: CustomAgent,
  memoryLevel: SnapshotMemoryLevel,
  format: SnapshotFormat,
  avatarPngDataUrl?: string | null
): Buffer {
  const envelope = agentToEnvelope(agent, memoryLevel)
  return encodeEnvelope(envelope, format, parsePngDataUrl(avatarPngDataUrl))
}

export type ExportAgentSnapshotInput = {
  id: string
  memoryLevel: SnapshotMemoryLevel
  format: SnapshotFormat
  avatarPngDataUrl?: string | null
}

/** Opens a native save dialog and writes the snapshot; returns false if the user cancels. */
export async function exportAgentSnapshot(input: ExportAgentSnapshotInput): Promise<boolean> {
  const agent = getAgent(input.id)
  if (!agent) {
    throw new Error(`Agent not found: ${input.id}`)
  }
  const bytes = buildEnvelopeBytes(agent, input.memoryLevel, input.format, input.avatarPngDataUrl)
  const { dialog } = await import('electron')
  const extension = input.format === 'png' ? 'png' : 'agent.json'
  const safeName = agent.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export agent snapshot',
    defaultPath: `${safeName}.${extension}`,
    filters:
      input.format === 'png'
        ? [{ name: 'Agent snapshot image', extensions: ['png'] }]
        : [{ name: 'Agent snapshot', extensions: ['json'] }]
  })
  if (canceled || !filePath) {
    return false
  }
  const { writeFile } = await import('node:fs/promises')
  await writeFile(filePath, bytes)
  return true
}

export type EncodedAgentSnapshot = { fileBytes: number[]; fileName: string }

export function encodeAgentSnapshotForSend(input: ExportAgentSnapshotInput): EncodedAgentSnapshot {
  const agent = getAgent(input.id)
  if (!agent) {
    throw new Error(`Agent not found: ${input.id}`)
  }
  const bytes = buildEnvelopeBytes(agent, input.memoryLevel, input.format, input.avatarPngDataUrl)
  const safeName = agent.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'
  const extension = input.format === 'png' ? 'png' : 'agent.json'
  return { fileBytes: Array.from(bytes), fileName: `${safeName}.${extension}` }
}

export type AgentSnapshotImportPreview = {
  displayName: string
  isBuiltIn: boolean
  model: string | null
  runtime: string | null
  systemPrompt: string | null
  avatarUrl: string | null
  memoryLevel: string
  memoryEntryCount: number
  hasSourceAllowlist: boolean
  sourceAllowlistCount: number
}

/**
 * Field-level parsing shared by the top-level agent snapshot envelope and
 * team-snapshot.ts's embedded per-member objects (a team snapshot nests one
 * of these per member, without its own magic/version wrapper — the outer
 * team envelope carries that instead). Exported so the two import paths
 * validate member fields identically.
 */
export function parseAgentEnvelopeFields(raw: Record<string, unknown>): AgentSnapshotEnvelope {
  const displayName = readBoundedString(raw.displayName) ?? ''
  if (!displayName.trim()) {
    throw new Error('Snapshot is missing a display name')
  }
  const memoryLevels: SnapshotMemoryLevel[] = ['none', 'core', 'everything']
  const memoryLevel = memoryLevels.includes(raw.memoryLevel as SnapshotMemoryLevel)
    ? (raw.memoryLevel as SnapshotMemoryLevel)
    : 'none'
  return {
    magic: AGENT_SNAPSHOT_MAGIC,
    version: 1,
    displayName: displayName.trim(),
    systemPrompt: readBoundedString(raw.systemPrompt),
    model: readBoundedString(raw.model),
    runtime: readBoundedString(raw.runtime),
    accountId: safeAccountIdOrNull(readBoundedString(raw.accountId)),
    avatarUrl: readBoundedString(raw.avatarUrl),
    respondToAllowlist: readBoundedStringArray(raw.respondToAllowlist),
    memoryLevel
  }
}

function decodeAgentEnvelope(fileBytes: number[]): AgentSnapshotEnvelope {
  const decoded = decodeEnvelopeBytes(Uint8Array.from(fileBytes), AGENT_SNAPSHOT_MAGIC)
  if (!decoded.ok) {
    throw new Error(decoded.reason)
  }
  return parseAgentEnvelopeFields(decoded.value)
}

export function previewAgentSnapshotImport(fileBytes: number[]): AgentSnapshotImportPreview {
  const envelope = decodeAgentEnvelope(fileBytes)
  return {
    displayName: envelope.displayName,
    isBuiltIn: false,
    model: envelope.model,
    runtime: envelope.runtime,
    systemPrompt: envelope.systemPrompt,
    avatarUrl: envelope.avatarUrl,
    memoryLevel: envelope.memoryLevel,
    memoryEntryCount: 0,
    hasSourceAllowlist: envelope.respondToAllowlist.length > 0,
    sourceAllowlistCount: envelope.respondToAllowlist.length
  }
}

export type AgentSnapshotImportResult = {
  displayName: string
  newPubkey: string
  personaId: string
  memoryWritten: number
  memoryTotal: number
  memoryErrors: string[]
  profileSyncError: string | null
}

export type ConfirmAgentSnapshotImportInput = {
  fileBytes: number[]
  keepAllowlist: boolean
}

/**
 * Creates a brand-new agent from a decoded, validated envelope. Never
 * reuses an existing agent's id. Shared by confirmAgentSnapshotImport below
 * and team-snapshot.ts's confirmTeamSnapshotImport (one member = one agent
 * created this same way), so the two import paths can't drift.
 *
 * `keepAllowlist` is accepted (matches the wire contract both callers
 * expose) but is currently a no-op: CustomAgent has no respond-to-allowlist
 * field to apply it to. Not a silent drop — see the build report's
 * PER_COMMAND notes.
 */
export function createAgentFromEnvelope(
  envelope: AgentSnapshotEnvelope,
  _keepAllowlist: boolean
): { agent: CustomAgent; newPubkey: string } {
  // Why unique-name suffix: agents-store has no uniqueness constraint on
  // `name`, but importing the same snapshot twice producing two
  // identically-named agents is confusing — disambiguate deterministically.
  const existingNames = new Set(listAgents().map((agent) => agent.name))
  let name = envelope.displayName
  let suffix = 2
  while (existingNames.has(name)) {
    name = `${envelope.displayName} (${suffix})`
    suffix += 1
  }
  const created = createAgent({
    name,
    systemPrompt: envelope.systemPrompt ?? '',
    engine: envelope.runtime === 'codex' ? 'codex' : 'claude',
    model: envelope.model ?? undefined,
    // Why not envelope.accountId: an imported account id refers to a
    // managed Claude/Codex account on the SENDER's machine, not this one.
    // Carrying it over would silently bind the new agent to an account id
    // that doesn't exist (or worse, collides with an unrelated local
    // account) here — leave it unset so the user picks explicitly.
    accountId: null
  })
  const newAgent = created.at(-1)
  if (!newAgent) {
    throw new Error('Failed to create agent from snapshot')
  }
  return { agent: newAgent, newPubkey: randomBytes(32).toString('hex') }
}

export function confirmAgentSnapshotImport(input: ConfirmAgentSnapshotImportInput): AgentSnapshotImportResult {
  const envelope = decodeAgentEnvelope(input.fileBytes)
  const { agent, newPubkey } = createAgentFromEnvelope(envelope, input.keepAllowlist)
  return {
    displayName: agent.name,
    newPubkey,
    personaId: agent.id,
    memoryWritten: 0,
    memoryTotal: 0,
    memoryErrors: [],
    profileSyncError: null
  }
}
