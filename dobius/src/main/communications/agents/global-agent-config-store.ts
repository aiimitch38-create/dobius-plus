import path from 'node:path'
import { app } from 'electron'
import { SafeJsonFile } from '../../storage/safe-json-file'

const FILE_NAME = 'communications-global-agent-config.json'

export type GlobalAgentConfig = {
  env_vars: Record<string, string>
  provider: string | null
  model: string | null
  preferred_runtime: string | null
}

type StoredFile = {
  config: GlobalAgentConfig
  // Why: Buzz's set_agent_managed_profiles is an unrelated boolean flag (no
  // shared shape with GlobalAgentConfig), but it is a similarly small global
  // preference with no other natural home in this repo, so it rides along in
  // the same small persisted file rather than spinning up a second file for
  // one boolean.
  agentManagedProfiles: boolean
}

const DEFAULT_CONFIG: GlobalAgentConfig = {
  env_vars: {},
  provider: null,
  model: null,
  preferred_runtime: null
}

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function sanitizeConfig(raw: unknown): GlobalAgentConfig {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_CONFIG }
  }
  const record = raw as Partial<Record<keyof GlobalAgentConfig, unknown>>
  const envVars: Record<string, string> = {}
  if (typeof record.env_vars === 'object' && record.env_vars !== null && !Array.isArray(record.env_vars)) {
    for (const [key, value] of Object.entries(record.env_vars as Record<string, unknown>)) {
      // Why: an empty value means "inherit" per the real Buzz contract — strip it
      // on read the same way the backend strips it on write.
      if (typeof value === 'string' && value !== '') {
        envVars[key] = value
      }
    }
  }
  return {
    env_vars: envVars,
    provider: typeof record.provider === 'string' && record.provider ? record.provider : null,
    model: typeof record.model === 'string' && record.model ? record.model : null,
    preferred_runtime:
      typeof record.preferred_runtime === 'string' && record.preferred_runtime
        ? record.preferred_runtime
        : null
  }
}

// Why: a file that is not an object is unreadable (never replaced by defaults
// and then saved over).
function sanitize(raw: unknown): StoredFile | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined
  }
  const record = raw as { config?: unknown; agentManagedProfiles?: unknown }
  return {
    config: sanitizeConfig(record.config),
    agentManagedProfiles: record.agentManagedProfiles === true
  }
}

const file = new SafeJsonFile<StoredFile>({
  filePath,
  parse: sanitize,
  fallback: () => ({ config: { ...DEFAULT_CONFIG }, agentManagedProfiles: false }),
  label: `[communications/agents] ${FILE_NAME}`
})

function load(): StoredFile {
  return file.get()
}

// Throws like the old writer did, so the RPC caller sees that nothing was saved.
function persist(data: StoredFile): void {
  if (!file.set(data)) {
    throw new Error('Global agent config could not be saved')
  }
}

const RESERVED_ENV_KEYS = new Set(['PATH', 'HOME', 'ANTHROPIC_API_KEY'])

export function getGlobalAgentConfig(): GlobalAgentConfig {
  return { ...load().config, env_vars: { ...load().config.env_vars } }
}

export function setGlobalAgentConfig(config: GlobalAgentConfig): GlobalAgentConfig {
  for (const key of Object.keys(config.env_vars ?? {})) {
    if (RESERVED_ENV_KEYS.has(key.toUpperCase())) {
      throw new Error(`"${key}" is a reserved environment variable and cannot be overridden`)
    }
  }
  const sanitized = sanitizeConfig(config)
  const data = load()
  data.config = sanitized
  persist(data)
  return { ...sanitized }
}

export function getAgentManagedProfiles(): boolean {
  return load().agentManagedProfiles
}

export function setAgentManagedProfiles(enabled: boolean): boolean {
  const data = load()
  data.agentManagedProfiles = enabled === true
  persist(data)
  return data.agentManagedProfiles
}
