// Persisted intent: which worktrees had `lead start` run and not `lead stop`.
// Read once at app boot so leads come back without a manual restart.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const AUTOSTART_FILE_NAME = 'autostart.json'

export type LeadAutostartEntry = { worktreePath: string; profile: string }

export function leadAutostartPath(homeDir = homedir()): string {
  return join(homeDir, '.dobius', 'leads', AUTOSTART_FILE_NAME)
}

function isEntry(value: unknown): value is LeadAutostartEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as LeadAutostartEntry).worktreePath === 'string' &&
    typeof (value as LeadAutostartEntry).profile === 'string'
  )
}

export function readLeadAutostart(
  homeDir?: string,
  log: (message: string, error?: unknown) => void = (message, error) => console.warn(message, error)
): LeadAutostartEntry[] {
  const filePath = leadAutostartPath(homeDir)
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    // Why: autostart.json is a cache of intent; a corrupt file means no leads
    // come back on this launch, which is recoverable with `lead start`.
    log(`[lead-autostart] ignoring unreadable ${filePath}`, error)
    return []
  }
  return Array.isArray(parsed) ? parsed.filter(isEntry) : []
}

function writeLeadAutostart(entries: LeadAutostartEntry[], homeDir?: string): void {
  const filePath = leadAutostartPath(homeDir)
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(entries, null, 2))
  renameSync(tmp, filePath)
}

/** Adds the worktree or replaces its profile; one entry per worktree path. */
export function upsertLeadAutostart(entry: LeadAutostartEntry, homeDir?: string): void {
  const rest = readLeadAutostart(homeDir).filter((e) => e.worktreePath !== entry.worktreePath)
  writeLeadAutostart([...rest, entry], homeDir)
}

export function removeLeadAutostart(worktreePath: string, homeDir?: string): boolean {
  const entries = readLeadAutostart(homeDir)
  const rest = entries.filter((e) => e.worktreePath !== worktreePath)
  if (rest.length === entries.length) {
    return false
  }
  writeLeadAutostart(rest, homeDir)
  return true
}

export function isLeadAutostarted(worktreePath: string, homeDir?: string): boolean {
  return readLeadAutostart(homeDir).some((e) => e.worktreePath === worktreePath)
}

export type LeadAutostartBootDeps = {
  entries: LeadAutostartEntry[]
  /** Resolves `path:<worktreePath>`; throws when the path is no longer a managed worktree. */
  resolveWorktree: (worktreePath: string) => Promise<{ id: string; path: string }>
  /** The lead.start code path; throws on an invalid lead config. */
  start: (worktreeSelector: string) => Promise<unknown>
  log?: (message: string) => void
}

export type LeadAutostartBootResult = { started: string[]; skipped: string[] }

/** Starts every entry that still resolves; a bad entry is logged and skipped, never thrown. */
export async function bootLeadAutostart(
  deps: LeadAutostartBootDeps
): Promise<LeadAutostartBootResult> {
  const log = deps.log ?? ((message: string) => console.warn(message))
  const result: LeadAutostartBootResult = { started: [], skipped: [] }
  for (const entry of deps.entries) {
    try {
      const worktree = await deps.resolveWorktree(entry.worktreePath)
      await deps.start(`id:${worktree.id}`)
      result.started.push(entry.worktreePath)
    } catch (error) {
      result.skipped.push(entry.worktreePath)
      log(
        `[lead-autostart] skipped ${entry.profile} at ${entry.worktreePath}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
  return result
}
