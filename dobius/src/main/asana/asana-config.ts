import path from 'node:path'
import type { AsanaConfig, AsanaProjectRef } from '../../shared/asana'
import { DEFAULT_ASANA_CONFIG } from '../../shared/asana'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { parseEveryEntry, SafeJsonFile } from '../storage/safe-json-file'
import { getUserDataRoot } from '../storage/user-data-root'

// Why: Asana automation keeps its own JSON file instead of the typed settings
// store so the feature can evolve without touching GlobalSettings migrations.
const CONFIG_FILE_NAME = 'asana-config.json'

function configFilePath(): string {
  return path.join(getUserDataRoot(), CONFIG_FILE_NAME)
}

function sanitizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function sanitizeProjectRef(entry: unknown): AsanaProjectRef | null {
  if (typeof entry !== 'object' || entry === null) {
    return null
  }
  const record = entry as Partial<Record<keyof AsanaProjectRef, unknown>>
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  const gid = typeof record.gid === 'string' ? record.gid.trim() : ''
  return name && gid ? { name, gid } : null
}

function sanitizeAllowedProjects(value: unknown): AsanaProjectRef[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ASANA_CONFIG.allowedProjects]
  }
  return value.flatMap((entry) => {
    const project = sanitizeProjectRef(entry)
    return project ? [project] : []
  })
}

// Why: the saved file's project list is never filtered on load; one malformed
// entry makes the file unreadable instead of being dropped and saved over (CX12 F2).
function parseStoredConfig(raw: unknown): AsanaConfig | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined
  }
  const { allowedProjects } = raw as Partial<Record<keyof AsanaConfig, unknown>>
  if (Array.isArray(allowedProjects) && !parseEveryEntry(allowedProjects, sanitizeProjectRef)) {
    return undefined
  }
  return sanitizeConfig(raw)
}

function sanitizeAutoMode(value: unknown): AsanaConfig['autoMode'] {
  if (typeof value !== 'object' || value === null) {
    return { ...DEFAULT_ASANA_CONFIG.autoMode }
  }
  const record = value as Partial<Record<keyof AsanaConfig['autoMode'], unknown>>
  const triageAgentId = typeof record.triageAgentId === 'string' ? record.triageAgentId.trim() : ''
  const buildAgent = isTuiAgent(record.buildAgent)
    ? record.buildAgent
    : DEFAULT_ASANA_CONFIG.autoMode.buildAgent
  const autoMode: AsanaConfig['autoMode'] = {
    enabled: record.enabled === true,
    intervalMinutes:
      typeof record.intervalMinutes === 'number' &&
      Number.isFinite(record.intervalMinutes) &&
      record.intervalMinutes > 0
        ? Math.floor(record.intervalMinutes)
        : DEFAULT_ASANA_CONFIG.autoMode.intervalMinutes,
    buildAgent
  }
  if (triageAgentId) {
    autoMode.triageAgentId = triageAgentId
  }
  return autoMode
}

export function sanitizeConfig(raw: unknown): AsanaConfig {
  if (typeof raw !== 'object' || raw === null) {
    return {
      ...DEFAULT_ASANA_CONFIG,
      allowedProjects: [...DEFAULT_ASANA_CONFIG.allowedProjects],
      autoMode: { ...DEFAULT_ASANA_CONFIG.autoMode }
    }
  }
  const record = raw as Partial<Record<keyof AsanaConfig, unknown>>
  return {
    myGid: sanitizeString(record.myGid, DEFAULT_ASANA_CONFIG.myGid),
    reviewGid: sanitizeString(record.reviewGid, DEFAULT_ASANA_CONFIG.reviewGid),
    allowedProjects: sanitizeAllowedProjects(record.allowedProjects),
    autoMode: sanitizeAutoMode(record.autoMode)
  }
}

// Why: an unreadable file yields defaults (auto mode off) and is never overwritten.
const file = new SafeJsonFile<AsanaConfig>({
  filePath: configFilePath,
  parse: parseStoredConfig,
  fallback: () => sanitizeConfig(DEFAULT_ASANA_CONFIG),
  label: '[asana] asana-config.json'
})

export function getAsanaConfig(): AsanaConfig {
  const cached = file.get()
  return {
    ...cached,
    allowedProjects: cached.allowedProjects.map((project) => ({ ...project })),
    autoMode: { ...cached.autoMode }
  }
}

export function updateAsanaConfig(updates: Partial<AsanaConfig>): AsanaConfig {
  // Why: partial updates arrive with absent fields as undefined; spreading
  // those would clobber stored values, so drop them first.
  const definedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  )
  const next = sanitizeConfig({ ...getAsanaConfig(), ...definedUpdates })
  file.set(next)
  return {
    ...next,
    allowedProjects: next.allowedProjects.map((project) => ({ ...project })),
    autoMode: { ...next.autoMode }
  }
}
