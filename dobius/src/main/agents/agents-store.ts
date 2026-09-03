import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type {
  AgentEngine,
  CustomAgent,
  CustomAgentInput,
  CustomAgentUpdate
} from '../../shared/agents'
import {
  normalizeColor,
  normalizeChannels,
  normalizeHeartbeat,
  normalizeIcon,
  normalizeNotify,
  normalizeSkills
} from './agent-record-normalization'

const FILE_NAME = 'agents.json'
const DEFAULT_MODEL = 'claude-opus-4-8'
const DEFAULT_ALLOWED_TOOLS = ['Read', 'Grep', 'Glob']

function normalizeEngine(value: unknown): AgentEngine {
  return value === 'codex' ? 'codex' : 'claude'
}

function normalizeModel(value: unknown, engine: AgentEngine): string {
  return typeof value === 'string' && value ? value : engine === 'codex' ? '' : DEFAULT_MODEL
}

let cached: CustomAgent[] | null = null

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function cloneAgent(agent: CustomAgent): CustomAgent {
  return {
    ...agent,
    allowedTools: [...agent.allowedTools],
    skills: [...agent.skills],
    heartbeat: { ...agent.heartbeat },
    channels: { ...agent.channels },
    sessionsByKey: agent.sessionsByKey ? { ...agent.sessionsByKey } : undefined
  }
}

function sanitizeSessionsByKey(
  raw: unknown
): Record<string, { sessionId: string; cwd: string }> | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const sessions: Record<string, { sessionId: string; cwd: string }> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const entry = value as Record<string, unknown>
    if (typeof entry.sessionId === 'string' && typeof entry.cwd === 'string') {
      sessions[key] = { sessionId: entry.sessionId, cwd: entry.cwd }
    }
  }
  return Object.keys(sessions).length > 0 ? sessions : undefined
}

function sanitize(raw: unknown): CustomAgent[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const record = entry as Partial<Record<keyof CustomAgent, unknown>>
    const id = typeof record.id === 'string' ? record.id : ''
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!id || !name) {
      return []
    }
    const engine = normalizeEngine(record.engine)
    return [
      {
        id,
        name,
        description: typeof record.description === 'string' ? record.description : '',
        icon: normalizeIcon(record.icon),
        color: normalizeColor(record.color),
        systemPrompt: typeof record.systemPrompt === 'string' ? record.systemPrompt : '',
        engine,
        accountId: typeof record.accountId === 'string' && record.accountId ? record.accountId : null,
        model: normalizeModel(record.model, engine),
        allowedTools: Array.isArray(record.allowedTools)
          ? record.allowedTools.filter((tool): tool is string => typeof tool === 'string' && !!tool)
          : [...DEFAULT_ALLOWED_TOOLS],
        skills: normalizeSkills(record.skills),
        cwd: typeof record.cwd === 'string' ? record.cwd : '',
        bypassPermissions: record.bypassPermissions === true,
        heartbeat: normalizeHeartbeat(record.heartbeat),
        notify: normalizeNotify(record.notify),
        channels: normalizeChannels(record.channels),
        lastHeartbeatAt:
          typeof record.lastHeartbeatAt === 'number' ? record.lastHeartbeatAt : undefined,
        lastSessionId: typeof record.lastSessionId === 'string' ? record.lastSessionId : undefined,
        lastSessionCwd:
          typeof record.lastSessionCwd === 'string' ? record.lastSessionCwd : undefined,
        sessionsByKey: sanitizeSessionsByKey(record.sessionsByKey),
        createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now()
      }
    ]
  })
}

function load(): CustomAgent[] {
  if (cached) {
    return cached
  }
  try {
    cached = sanitize(JSON.parse(readFileSync(filePath(), 'utf-8')))
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      console.warn(
        '[agents] failed to load agents:',
        error instanceof Error ? error.message : String(error)
      )
    }
    cached = []
  }
  return cached
}

function persist(agents: CustomAgent[]): void {
  const target = filePath()
  const tmp = `${target}.${process.pid}.tmp`
  try {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(tmp, `${JSON.stringify(agents, null, 2)}\n`, 'utf-8')
    renameSync(tmp, target)
  } catch (error) {
    console.warn(
      '[agents] failed to persist agents:',
      error instanceof Error ? error.message : String(error)
    )
  }
}

function assertValidName(name: string): void {
  if (!name.trim()) {
    throw new Error('Agent name is required')
  }
}

function assertValidCwd(cwd: string): void {
  if (!cwd) {
    return
  }
  const resolved =
    cwd === '~' ? app.getPath('home') : cwd.replace(/^~(?=$|[/\\])/, app.getPath('home'))
  if (!existsSync(resolved)) {
    throw new Error(`Working directory does not exist: ${cwd}`)
  }
  if (!statSync(resolved).isDirectory()) {
    throw new Error(`Working directory is not a directory: ${cwd}`)
  }
}

function normalizeAllowedTools(tools: string[] | undefined): string[] {
  const normalized = tools?.filter((tool) => tool.trim()).map((tool) => tool.trim()) ?? []
  return normalized.length > 0 ? [...new Set(normalized)] : [...DEFAULT_ALLOWED_TOOLS]
}

export function listAgents(): CustomAgent[] {
  return load().map(cloneAgent)
}

export function getAgent(id: string): CustomAgent | null {
  const agent = load().find((entry) => entry.id === id)
  return agent ? cloneAgent(agent) : null
}

export function createAgent(input: CustomAgentInput): CustomAgent[] {
  const name = input.name.trim()
  const cwd = input.cwd?.trim() ?? ''
  assertValidName(name)
  assertValidCwd(cwd)
  const now = Date.now()
  const agents = load()
  const engine = normalizeEngine(input.engine)
  agents.push({
    id: randomUUID(),
    name,
    description: input.description ?? '',
    icon: normalizeIcon(input.icon),
    color: normalizeColor(input.color),
    systemPrompt: input.systemPrompt ?? '',
    engine,
    accountId: input.accountId?.trim() || null,
    model: normalizeModel(input.model, engine),
    allowedTools: normalizeAllowedTools(input.allowedTools),
    skills: normalizeSkills(input.skills),
    cwd,
    bypassPermissions: input.bypassPermissions === true,
    heartbeat: normalizeHeartbeat(input.heartbeat),
    notify: normalizeNotify(input.notify),
    channels: normalizeChannels(input.channels),
    createdAt: now,
    updatedAt: now
  })
  cached = agents
  persist(agents)
  return listAgents()
}

export function updateAgent(id: string, updates: CustomAgentUpdate): CustomAgent[] {
  const agents = load()
  const agent = agents.find((entry) => entry.id === id)
  if (!agent) {
    throw new Error('Agent not found')
  }
  if (updates.name !== undefined) {
    assertValidName(updates.name)
    agent.name = updates.name.trim()
  }
  if (updates.cwd !== undefined) {
    const cwd = updates.cwd.trim()
    assertValidCwd(cwd)
    agent.cwd = cwd
  }
  if (updates.description !== undefined) {
    agent.description = updates.description
  }
  if (updates.icon !== undefined) {
    agent.icon = normalizeIcon(updates.icon)
  }
  if (updates.color !== undefined) {
    agent.color = normalizeColor(updates.color)
  }
  if (updates.systemPrompt !== undefined) {
    agent.systemPrompt = updates.systemPrompt
  }
  if (updates.engine !== undefined) {
    const previousEngine = agent.engine ?? 'claude'
    agent.engine = normalizeEngine(updates.engine)
    if (updates.model === undefined && agent.engine !== previousEngine) {
      agent.model = normalizeModel(undefined, agent.engine)
    }
  }
  if (updates.accountId !== undefined) {
    agent.accountId = updates.accountId?.trim() || null
  }
  if (updates.model !== undefined) {
    agent.model = normalizeModel(updates.model, agent.engine ?? 'claude')
  }
  if (updates.allowedTools !== undefined) {
    agent.allowedTools = normalizeAllowedTools(updates.allowedTools)
  }
  if (updates.skills !== undefined) {
    agent.skills = normalizeSkills(updates.skills)
  }
  if (updates.bypassPermissions !== undefined) {
    agent.bypassPermissions = updates.bypassPermissions
  }
  if (updates.heartbeat !== undefined) {
    agent.heartbeat = normalizeHeartbeat(updates.heartbeat)
  }
  if (updates.notify !== undefined) {
    agent.notify = normalizeNotify(updates.notify)
  }
  if (updates.channels !== undefined) {
    agent.channels = normalizeChannels(updates.channels)
  }
  agent.updatedAt = Date.now()
  cached = agents
  persist(agents)
  return listAgents()
}

export function updateAgentHeartbeatAt(id: string, lastHeartbeatAt: number): void {
  const agents = load()
  const agent = agents.find((entry) => entry.id === id)
  if (!agent) {
    return
  }
  agent.lastHeartbeatAt = lastHeartbeatAt
  agent.updatedAt = Date.now()
  cached = agents
  persist(agents)
}

export function updateAgentSession(
  id: string,
  updates: { lastSessionId?: string; lastSessionCwd?: string; sessionKey?: string }
): void {
  const agents = load()
  const agent = agents.find((entry) => entry.id === id)
  if (!agent) {
    return
  }
  const key = updates.sessionKey ?? 'default'
  if (updates.lastSessionId && updates.lastSessionCwd) {
    agent.sessionsByKey = {
      ...agent.sessionsByKey,
      [key]: { sessionId: updates.lastSessionId, cwd: updates.lastSessionCwd }
    }
  }
  // The legacy single-session fields mirror the default key only: a channel
  // task must never hijack the session a manual run would resume.
  if (key === 'default') {
    agent.lastSessionId = updates.lastSessionId
    agent.lastSessionCwd = updates.lastSessionCwd
  }
  agent.updatedAt = Date.now()
  cached = agents
  persist(agents)
}

/** The continuing session for a task key, falling back to the legacy fields for 'default'. */
export function getAgentSessionForKey(
  agent: CustomAgent,
  sessionKey: string | undefined
): { sessionId: string; cwd: string } | null {
  const key = sessionKey ?? 'default'
  const keyed = agent.sessionsByKey?.[key]
  if (keyed) {
    return keyed
  }
  if (key === 'default' && agent.lastSessionId && agent.lastSessionCwd) {
    return { sessionId: agent.lastSessionId, cwd: agent.lastSessionCwd }
  }
  return null
}

export function resetAgentSession(id: string): CustomAgent[] {
  const agents = load()
  const agent = agents.find((entry) => entry.id === id)
  if (!agent) {
    throw new Error('Agent not found')
  }
  agent.lastSessionId = undefined
  agent.updatedAt = Date.now()
  cached = agents
  persist(agents)
  return listAgents()
}

export function removeAgent(id: string): CustomAgent[] {
  cached = load().filter((agent) => agent.id !== id)
  persist(cached)
  return listAgents()
}
