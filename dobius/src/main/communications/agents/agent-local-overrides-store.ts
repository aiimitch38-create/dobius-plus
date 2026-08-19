import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

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

let cached: OverridesFile | null = null

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function sanitizeEntry(raw: unknown): AgentLocalOverrides {
  if (typeof raw !== 'object' || raw === null) {
    return {}
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

function sanitize(raw: unknown): OverridesFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {}
  }
  const out: OverridesFile = {}
  for (const [agentId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof agentId === 'string' && agentId) {
      out[agentId] = sanitizeEntry(value)
    }
  }
  return out
}

function load(): OverridesFile {
  if (cached) {
    return cached
  }
  const target = filePath()
  if (!existsSync(target)) {
    cached = {}
    return cached
  }
  try {
    cached = sanitize(JSON.parse(readFileSync(target, 'utf-8')))
  } catch (error) {
    console.warn(
      '[communications/agents] failed to load agent overrides:',
      error instanceof Error ? error.message : String(error)
    )
    cached = {}
  }
  return cached
}

function persist(data: OverridesFile): void {
  const target = filePath()
  const tmp = `${target}.${process.pid}.tmp`
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
  renameSync(tmp, target)
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
  cached = data
  persist(data)
  return { ...data[agentId] }
}
