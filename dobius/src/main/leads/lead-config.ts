import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { LEAD_ID_PATTERN, MAX_WORKERS_PER_LEAD } from '../../shared/lead-caps'
import { isTuiAgent } from '../../shared/tui-agent-config'
import type { TuiAgent } from '../../shared/types'
import { DOBIUS_DIR_NAME } from './orchestrator-instructions'

export const LEAD_CONFIG_FILE_NAME = 'lead.json'
export const LEAD_PROFILE_PATTERN = LEAD_ID_PATTERN
export const LEAD_PROFILE_PREFIX = 'lead-'
export const DEFAULT_WORKER_AGENT: TuiAgent = 'codex'

export type LeadConfig = {
  profile: string
  projectId: string
  workerAgent: TuiAgent
  maxWorkers: number
}

export function leadConfigPath(repoPath: string): string {
  return join(repoPath, DOBIUS_DIR_NAME, LEAD_CONFIG_FILE_NAME)
}

/** Lowercase, non [a-z0-9_-] runs become '-', trimmed; falls back to 'project'. */
export function slugifyProjectName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  // Why: the profile is `lead-` + slug and the whole thing must fit the 64-char pattern.
  return (slug || 'project').slice(0, 64 - LEAD_PROFILE_PREFIX.length)
}

export function defaultLeadConfig(repoPath: string): LeadConfig {
  const slug = slugifyProjectName(basename(repoPath))
  return {
    profile: `${LEAD_PROFILE_PREFIX}${slug}`,
    projectId: slug,
    workerAgent: DEFAULT_WORKER_AGENT,
    maxWorkers: MAX_WORKERS_PER_LEAD
  }
}

/** The project slug a profile was derived from; used for ~/.dobius/leads/<slug>. */
export function leadSlugFromProfile(profile: string): string {
  return profile.startsWith(LEAD_PROFILE_PREFIX)
    ? profile.slice(LEAD_PROFILE_PREFIX.length) || profile
    : profile
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateLeadConfig(value: unknown, filePath: string): LeadConfig {
  if (!isRecord(value)) {
    throw new Error(`${filePath}: expected a JSON object`)
  }
  const { profile, projectId, workerAgent, maxWorkers } = value
  if (typeof profile !== 'string' || !LEAD_PROFILE_PATTERN.test(profile)) {
    throw new Error(`${filePath}: "profile" must match ${LEAD_PROFILE_PATTERN}`)
  }
  if (typeof projectId !== 'string' || !LEAD_PROFILE_PATTERN.test(projectId)) {
    throw new Error(`${filePath}: "projectId" must match ${LEAD_PROFILE_PATTERN}`)
  }
  if (!isTuiAgent(workerAgent)) {
    throw new Error(`${filePath}: "workerAgent" is not a known TUI agent`)
  }
  if (
    typeof maxWorkers !== 'number' ||
    !Number.isInteger(maxWorkers) ||
    maxWorkers < 1 ||
    maxWorkers > MAX_WORKERS_PER_LEAD
  ) {
    throw new Error(`${filePath}: "maxWorkers" must be an integer from 1 to ${MAX_WORKERS_PER_LEAD}`)
  }
  return { profile, projectId, workerAgent, maxWorkers }
}

/** Reads <repo>/.dobius/lead.json; missing keys take the repo-derived defaults. */
export function readLeadConfig(repoPath: string): LeadConfig {
  const filePath = leadConfigPath(repoPath)
  const defaults = defaultLeadConfig(repoPath)
  if (!existsSync(filePath)) {
    return defaults
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`${filePath}: invalid JSON (${(error as Error).message})`)
  }
  if (!isRecord(parsed)) {
    throw new Error(`${filePath}: expected a JSON object`)
  }
  return validateLeadConfig({ ...defaults, ...parsed }, filePath)
}

/** Returns true when the file was created; an existing file is never touched. */
export function writeLeadConfigIfMissing(repoPath: string, config: LeadConfig): boolean {
  const filePath = leadConfigPath(repoPath)
  if (existsSync(filePath)) {
    return false
  }
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' })
  return true
}
