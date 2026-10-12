import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { getUserDataRoot } from '../storage/user-data-root'

const FILE_NAME = 'agents-config.json'

export type AgentPingStatus = {
  used: number
  max: number
  date: string
}

type AgentsConfig = {
  agentsPaused: boolean
  maxPingsPerDay: number
  pingDate: string
  pingsUsed: number
}

const DEFAULT_CONFIG: AgentsConfig = {
  agentsPaused: false,
  maxPingsPerDay: 4,
  pingDate: todayKey(),
  pingsUsed: 0
}

let cached: AgentsConfig | null = null

function todayKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function filePath(): string {
  return path.join(getUserDataRoot(), FILE_NAME)
}

function sanitize(raw: unknown): AgentsConfig {
  const record =
    typeof raw === 'object' && raw !== null
      ? (raw as Partial<Record<keyof AgentsConfig, unknown>>)
      : {}
  return {
    agentsPaused: record.agentsPaused === true,
    maxPingsPerDay:
      typeof record.maxPingsPerDay === 'number' && Number.isFinite(record.maxPingsPerDay)
        ? Math.min(10, Math.max(1, Math.round(record.maxPingsPerDay)))
        : DEFAULT_CONFIG.maxPingsPerDay,
    pingDate: typeof record.pingDate === 'string' ? record.pingDate : todayKey(),
    pingsUsed:
      typeof record.pingsUsed === 'number' && Number.isFinite(record.pingsUsed)
        ? Math.max(0, Math.round(record.pingsUsed))
        : 0
  }
}

export type AgentsControlStatus = 'ok' | 'missing' | 'unreadable'

export type AgentsControlState = {
  // Effective value: always true while status is 'unreadable'.
  paused: boolean
  status: AgentsControlStatus
  // errno code or parse problem; never file contents.
  detail: string | null
  filePath: string
}

let loadStatus: AgentsControlStatus = 'ok'
let loadDetail: string | null = null
let lastLoggedDetail: string | null = null

function readConfigFile(): void {
  let text: string
  try {
    text = readFileSync(filePath(), 'utf-8')
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
    if (code === 'ENOENT') {
      // Why: first launch has no file; keep the historical unpaused default.
      loadStatus = 'missing'
      loadDetail = null
      cached = { ...DEFAULT_CONFIG }
      return
    }
    markUnreadable(code ?? (error instanceof Error ? error.message : String(error)))
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    markUnreadable('invalid JSON')
    return
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as { agentsPaused?: unknown }).agentsPaused !== 'boolean'
  ) {
    markUnreadable('agentsPaused missing or not a boolean')
    return
  }
  loadStatus = 'ok'
  loadDetail = null
  cached = sanitize(parsed)
}

// Why: a file that exists but can't be trusted must never unpause the crew.
function markUnreadable(detail: string): void {
  loadStatus = 'unreadable'
  loadDetail = detail
  cached = { ...DEFAULT_CONFIG, agentsPaused: true }
  if (lastLoggedDetail !== detail) {
    lastLoggedDetail = detail
    console.error(`[agents] crew control file unreadable (${filePath()}: ${detail}); crew paused`)
  }
}

function load(): AgentsConfig {
  // Unreadable state re-reads every call so a repaired file takes effect without a restart.
  if (cached && loadStatus !== 'unreadable') {
    return cached
  }
  readConfigFile()
  return rolloverPingDate(cached as AgentsConfig)
}

function persist(config: AgentsConfig): boolean {
  const target = filePath()
  const tmp = `${target}.${process.pid}.tmp`
  try {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
    renameSync(tmp, target)
    return true
  } catch (error) {
    console.warn(
      '[agents] failed to persist config:',
      error instanceof Error ? error.message : String(error)
    )
    return false
  }
}

function rolloverPingDate(config: AgentsConfig): AgentsConfig {
  const date = todayKey()
  if (config.pingDate === date) {
    return config
  }
  const next = { ...config, pingDate: date, pingsUsed: 0 }
  cached = next
  if (loadStatus !== 'unreadable') {
    persist(next)
  }
  return next
}

export function getAgentsControlState(): AgentsControlState {
  const config = load()
  return {
    paused: loadStatus === 'unreadable' ? true : config.agentsPaused,
    status: loadStatus,
    detail: loadDetail,
    filePath: filePath()
  }
}

export function getAgentsPaused(): boolean {
  return getAgentsControlState().paused
}

export function setAgentsPaused(paused: boolean): boolean {
  const current = load()
  if (loadStatus === 'unreadable') {
    if (paused) {
      // Already effectively paused; leave the unreadable file as evidence.
      return true
    }
    throw new Error(
      `Crew control file could not be read (${filePath()}: ${loadDetail}). Fix or remove it, then resume.`
    )
  }
  const config = { ...current, agentsPaused: paused }
  cached = config
  if (!persist(config) && paused) {
    console.error('[agents] pause could not be saved; crew is paused for this session only')
  }
  return config.agentsPaused
}

export function getPingStatus(): AgentPingStatus {
  const config = load()
  return { used: config.pingsUsed, max: config.maxPingsPerDay, date: config.pingDate }
}

export function consumePingBudget(): boolean {
  const config = load()
  if (loadStatus === 'unreadable' || config.pingsUsed >= config.maxPingsPerDay) {
    return false
  }
  const next = { ...config, pingsUsed: config.pingsUsed + 1 }
  cached = next
  persist(next)
  return true
}
