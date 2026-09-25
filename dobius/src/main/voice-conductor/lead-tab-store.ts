import path from 'node:path'
import { SafeJsonFile } from '../storage/safe-json-file'

type LeadTabPayload = {
  version: 1
  leadTabIdByProjectPath: Record<string, string>
}

export type LeadTabStore = {
  get(projectPath: string): string | null
  set(projectPath: string, tabId: string | null): void
}

function normalizeProjectPath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('\u0000')) {
    throw new Error('projectPath required')
  }
  return path.resolve(trimmed)
}

function isValidTabId(tabId: unknown): tabId is string {
  return typeof tabId === 'string' && tabId.length > 0 && tabId.length <= 512 && !tabId.includes('\u0000')
}

// Why: a malformed entry makes the file unreadable (kept, saves refused)
// instead of being dropped and then saved over.
function parsePayload(raw: unknown): LeadTabPayload | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const entries = (raw as { leadTabIdByProjectPath?: unknown }).leadTabIdByProjectPath
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    return undefined
  }
  const result: LeadTabPayload = { version: 1, leadTabIdByProjectPath: {} }
  for (const [projectPath, tabId] of Object.entries(entries)) {
    if (projectPath.length > 4096 || !isValidTabId(tabId)) {
      return undefined
    }
    result.leadTabIdByProjectPath[projectPath] = tabId
  }
  return result
}

export function createLeadTabStore(filePath: string): LeadTabStore {
  const file = new SafeJsonFile<LeadTabPayload>({
    filePath: () => filePath,
    parse: parsePayload,
    fallback: () => ({ version: 1, leadTabIdByProjectPath: {} }),
    label: '[voice-conductor] lead tabs',
    mode: 0o600
  })

  return {
    get(projectPath) {
      return file.get().leadTabIdByProjectPath[normalizeProjectPath(projectPath)] ?? null
    },
    set(projectPath, tabId) {
      const key = normalizeProjectPath(projectPath)
      if (tabId !== null && (!tabId.trim() || tabId.length > 512 || tabId.includes('\u0000'))) {
        throw new Error('tabId malformed')
      }
      const next = {
        version: 1 as const,
        leadTabIdByProjectPath: { ...file.get().leadTabIdByProjectPath }
      }
      if (tabId === null) {
        delete next.leadTabIdByProjectPath[key]
      } else {
        next.leadTabIdByProjectPath[key] = tabId
      }
      // Throws when the file is unreadable or the write fails, so the caller sees it.
      file.save(next)
    }
  }
}
