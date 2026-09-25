// The stored "Voice Conductor" agent record and its managed defaults.
//
// The conductor's prompt, model and tools are owned by this code, but they are
// stored on a normal agent the user can edit. Each start compares every managed
// field against the value this code last applied (or a known older shipped
// value): an untouched field gets the current default, an edited one is kept.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { CustomAgent, CustomAgentInput, CustomAgentUpdate } from '../../shared/agents'
import { createAgent, listAgents, updateAgent } from '../agents/agents-store'
import { SafeJsonFile } from '../storage/safe-json-file'
import { getUserDataRoot } from '../storage/user-data-root'
import { CONDUCTOR_SYSTEM_PROMPT } from './conductor-system-prompt'

// The store assigns each agent a random UUID, so the conductor agent is
// identified by this stable name (looked up via listAgents), not a fixed id.
export const CONDUCTOR_AGENT_NAME = 'Voice Conductor'
const CONDUCTOR_DIR_NAME = 'dobius-voice-conductor'
const CONDUCTOR_CWD = `~/${CONDUCTOR_DIR_NAME}`
// Opus-class reasoning is required to disambiguate fuzzy transcripts
// ("be to be portal" => "B2B Portal").
const CONDUCTOR_MODEL = 'opus'
export const CONDUCTOR_ALLOWED_TOOLS = [
  'Bash',
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch'
]

export type ManagedField = 'systemPrompt' | 'model' | 'allowedTools'

export type ConductorManagedDefaults = Pick<CustomAgent, ManagedField>

export const CONDUCTOR_MANAGED_DEFAULTS: ConductorManagedDefaults = {
  systemPrompt: CONDUCTOR_SYSTEM_PROMPT,
  model: CONDUCTOR_MODEL,
  allowedTools: CONDUCTOR_ALLOWED_TOOLS
}

const MANAGED_FIELDS: readonly ManagedField[] = ['systemPrompt', 'model', 'allowedTools']

/**
 * sha256 of every system prompt shipped before this record existed
 * (git caee2df0 and 4df99594). An install created by those versions has no
 * record, so these identify its prompt as untouched. Model and tools never
 * changed, so their current value covers them.
 */
export const LEGACY_MANAGED_HASHES: Readonly<Record<ManagedField, readonly string[]>> = {
  systemPrompt: [
    'c80fc648a3c46044fe678a2be5a7cba7d77ee0adfffe9ed10652b452b2a7562d',
    'aa2fb413aabd77bdf7071be38d9cd28ad36dc43f1941c78e94508e2a6b5a409c'
  ],
  model: [],
  allowedTools: []
}

export type ConductorManagedRecord = {
  version: 1
  agentId: string
  // Hash of the value this code last wrote to each field.
  applied: Partial<Record<ManagedField, string>>
}

export function managedFieldHash(value: string | readonly string[]): string {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex')
}

/**
 * Pure: which managed fields to update and the record to store afterwards.
 * A field is replaced only when its stored value is one this code wrote.
 */
export function planManagedFieldMigration(
  agent: Pick<CustomAgent, 'id' | ManagedField>,
  defaults: ConductorManagedDefaults,
  record: ConductorManagedRecord | null
): { updates: CustomAgentUpdate; record: ConductorManagedRecord; kept: ManagedField[] } {
  const previous = record?.agentId === agent.id ? record.applied : {}
  const updates: CustomAgentUpdate = {}
  const applied: Partial<Record<ManagedField, string>> = {}
  const kept: ManagedField[] = []
  for (const field of MANAGED_FIELDS) {
    const stored = managedFieldHash(agent[field])
    const current = managedFieldHash(defaults[field])
    if (stored === current) {
      applied[field] = current
      continue
    }
    if (stored === previous[field] || LEGACY_MANAGED_HASHES[field].includes(stored)) {
      Object.assign(updates, { [field]: defaults[field] })
      applied[field] = current
      continue
    }
    // A user edit: keep it, and keep what we last wrote so a later default
    // change still recognises nothing of ours is in this field.
    kept.push(field)
    if (previous[field]) {
      applied[field] = previous[field]
    }
  }
  return { updates, record: { version: 1, agentId: agent.id, applied }, kept }
}

function parseRecord(raw: unknown): ConductorManagedRecord | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const value = raw as Record<string, unknown>
  if (value.version !== 1 || typeof value.agentId !== 'string') {
    return undefined
  }
  const appliedRaw = value.applied
  if (!appliedRaw || typeof appliedRaw !== 'object' || Array.isArray(appliedRaw)) {
    return undefined
  }
  const applied: Partial<Record<ManagedField, string>> = {}
  for (const [field, hash] of Object.entries(appliedRaw)) {
    if (!MANAGED_FIELDS.includes(field as ManagedField) || typeof hash !== 'string') {
      return undefined
    }
    applied[field as ManagedField] = hash
  }
  return { version: 1, agentId: value.agentId, applied }
}

export type ConductorAgentDeps = {
  listAgents(): CustomAgent[]
  createAgent(input: CustomAgentInput): CustomAgent[]
  updateAgent(id: string, updates: CustomAgentUpdate): CustomAgent[]
  ensureCwd(): void
  // null = no record yet; 'unreadable' = the file exists but can't be trusted.
  readRecord(): ConductorManagedRecord | null | 'unreadable'
  writeRecord(record: ConductorManagedRecord): void
}

function conductorDir(): string {
  return path.join(homedir(), CONDUCTOR_DIR_NAME)
}

export function ensureConductorDir(): void {
  // createAgent's assertValidCwd rejects a non-existent cwd, so the dir must
  // exist before the agent is created.
  const dir = conductorDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

let recordFile: SafeJsonFile<ConductorManagedRecord | null> | null = null

function managedRecordFile(): SafeJsonFile<ConductorManagedRecord | null> {
  recordFile ??= new SafeJsonFile<ConductorManagedRecord | null>({
    filePath: () => path.join(getUserDataRoot(), 'voice-conductor-agent.json'),
    parse: parseRecord,
    fallback: () => null,
    label: '[voice-conductor] managed agent defaults'
  })
  return recordFile
}

export function defaultConductorAgentDeps(): ConductorAgentDeps {
  return {
    listAgents,
    createAgent,
    updateAgent,
    ensureCwd: ensureConductorDir,
    readRecord: () => {
      const file = managedRecordFile()
      const record = file.get()
      return file.getStatus().status === 'unreadable' ? 'unreadable' : record
    },
    writeRecord: (record) => {
      managedRecordFile().set(record)
    }
  }
}

/** Finds or creates the conductor agent and brings its managed fields up to date. */
export function ensureConductorAgentId(deps: ConductorAgentDeps = defaultConductorAgentDeps()): string {
  const existing = deps.listAgents().find((agent) => agent.name === CONDUCTOR_AGENT_NAME)
  if (!existing) {
    deps.ensureCwd()
    const agents = deps.createAgent({
      name: CONDUCTOR_AGENT_NAME,
      description: 'Background voice-transcript router (SDK agent-runner, no window or tab).',
      cwd: CONDUCTOR_CWD,
      bypassPermissions: true,
      ...CONDUCTOR_MANAGED_DEFAULTS
    })
    const created = agents.find((agent) => agent.name === CONDUCTOR_AGENT_NAME)
    if (!created) {
      throw new Error('Failed to create the Voice Conductor agent')
    }
    deps.writeRecord(planManagedFieldMigration(created, CONDUCTOR_MANAGED_DEFAULTS, null).record)
    return created.id
  }
  const record = deps.readRecord()
  if (record === 'unreadable') {
    // Without the record a user edit can't be told apart from our old value; leave the agent alone.
    console.warn('[voice-conductor] managed defaults record unreadable; agent left unchanged')
    return existing.id
  }
  const plan = planManagedFieldMigration(existing, CONDUCTOR_MANAGED_DEFAULTS, record)
  if (Object.keys(plan.updates).length > 0) {
    deps.updateAgent(existing.id, plan.updates)
  }
  if (plan.kept.length > 0) {
    console.info(`[voice-conductor] kept user-edited agent fields: ${plan.kept.join(', ')}`)
  }
  if (JSON.stringify(plan.record) !== JSON.stringify(record)) {
    deps.writeRecord(plan.record)
  }
  return existing.id
}
