import path from 'node:path'
import { app } from 'electron'
import { parseEveryValue, SafeJsonFile } from '../../storage/safe-json-file'

const FILE_NAME = 'communications-agent-overrides.json'

// Why: Buzz's ManagedAgent/AgentPersona projections (loadDobiusManagedAgents,
// personaFromAgent in the vendor bridge) hardcode active/autoRestart/
// startOnAppLaunch — Dobius's CustomAgent record has no such fields and that
// vendor file is off-limits to edit here. This store lets the matching
// set_persona_active / set_managed_agent_auto_restart /
// set_managed_agent_start_on_app_launch RPC methods persist a real value;
// the vendor case block merges it into the response it returns immediately,
// though a later list_managed_agents/list_personas call will still show the
// hardcoded default until someone wires the projection to read this store.
export type AgentLocalOverrides = {
  active?: boolean
  autoRestartOnConfigChange?: boolean
  startOnAppLaunch?: boolean
}

type OverridesFile = Record<string, AgentLocalOverrides>

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

// Why: a malformed entry makes the whole file unreadable instead of being
// dropped and then saved over (CX12 F2).
function sanitizeEntry(raw: unknown): AgentLocalOverrides | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }
  const record = raw as Partial<Record<keyof AgentLocalOverrides, unknown>>
  const result: AgentLocalOverrides = {}
  if (typeof record.active === 'boolean') {
    result.active = record.active
  }
  if (typeof record.autoRestartOnConfigChange === 'boolean') {
    result.autoRestartOnConfigChange = record.autoRestartOnConfigChange
  }
  if (typeof record.startOnAppLaunch === 'boolean') {
    result.startOnAppLaunch = record.startOnAppLaunch
  }
  return result
}

const file = new SafeJsonFile<OverridesFile>({
  filePath,
  parse: (raw) => parseEveryValue(raw, sanitizeEntry),
  fallback: () => ({}),
  label: `[communications/agents] ${FILE_NAME}`
})

function load(): OverridesFile {
  return file.get()
}

// Throws like the old writer did, so the RPC caller sees that nothing was saved.
function persist(data: OverridesFile): void {
  if (!file.set(data)) {
    throw new Error('Agent overrides could not be saved')
  }
}

export function getAgentLocalOverrides(agentId: string): AgentLocalOverrides {
  return { ...load()[agentId] }
}

export function setAgentLocalOverride<K extends keyof AgentLocalOverrides>(
  agentId: string,
  key: K,
  value: AgentLocalOverrides[K]
): AgentLocalOverrides {
  const data = load()
  const existing = data[agentId] ?? {}
  data[agentId] = { ...existing, [key]: value }
  persist(data)
  return { ...data[agentId] }
}
