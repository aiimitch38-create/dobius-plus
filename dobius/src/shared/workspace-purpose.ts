// Purpose is a free-form label on a worktree ("Features", "Backend", …) used to
// group workspaces in the Board top bar and the Source Control workspace view.
// It is NOT a progress state — that is workspaceStatus (todo / in-review / …).

export const DEFAULT_WORKSPACE_PURPOSES = ['Features', 'Backend', 'Research'] as const

export const OTHER_WORKSPACE_PURPOSE_KEY = 'other'

/** Hard cap on a stored purpose label; longer input is trimmed then cut here. */
export const MAX_WORKSPACE_PURPOSE_LENGTH = 40

export type WorkspacePurposeGroup<T> = {
  /** Stable key for React/collapse state: `purpose:<lowercased label>` or `other`. */
  key: string
  /** Display label; null for the ungrouped bucket (callers translate "Other"). */
  purpose: string | null
  items: T[]
}

/** Trims, caps at MAX_WORKSPACE_PURPOSE_LENGTH and maps default labels
 *  case-insensitively; empty/blank → undefined. */
export function normalizeWorkspacePurpose(value: string | null | undefined): string | undefined {
  const trimmed = (value?.trim() ?? '').slice(0, MAX_WORKSPACE_PURPOSE_LENGTH).trim()
  if (!trimmed) {
    return undefined
  }
  const lower = trimmed.toLowerCase()
  return DEFAULT_WORKSPACE_PURPOSES.find((p) => p.toLowerCase() === lower) ?? trimmed
}

export function workspacePurposeKey(purpose: string | null | undefined): string {
  const normalized = normalizeWorkspacePurpose(purpose)
  return normalized ? `purpose:${normalized.toLowerCase()}` : OTHER_WORKSPACE_PURPOSE_KEY
}

/**
 * Groups items by purpose. Order: default purposes (Features, Backend,
 * Research) first in that order, then custom purposes alphabetically, then
 * "Other" last. Empty groups are omitted; item order within a group is kept.
 */
export function groupByWorkspacePurpose<T extends { purpose?: string | null }>(
  items: readonly T[]
): WorkspacePurposeGroup<T>[] {
  const byKey = new Map<string, WorkspacePurposeGroup<T>>()
  for (const item of items) {
    const purpose = normalizeWorkspacePurpose(item.purpose) ?? null
    const key = workspacePurposeKey(purpose)
    let group = byKey.get(key)
    if (!group) {
      group = { key, purpose, items: [] }
      byKey.set(key, group)
    }
    group.items.push(item)
  }
  const defaults = DEFAULT_WORKSPACE_PURPOSES.map((p) => byKey.get(workspacePurposeKey(p)))
  const defaultKeys = new Set(DEFAULT_WORKSPACE_PURPOSES.map((p) => workspacePurposeKey(p)))
  const custom = [...byKey.values()]
    .filter((g) => g.purpose !== null && !defaultKeys.has(g.key))
    .sort((a, b) => (a.purpose ?? '').localeCompare(b.purpose ?? ''))
  const other = byKey.get(OTHER_WORKSPACE_PURPOSE_KEY)
  return [
    ...defaults.filter((g): g is WorkspacePurposeGroup<T> => g !== undefined),
    ...custom,
    ...(other ? [other] : [])
  ]
}

/** Purpose labels to offer in a picker: defaults plus any custom ones in use. */
export function listWorkspacePurposeOptions(
  items: readonly { purpose?: string | null }[]
): string[] {
  const seen = new Set<string>(DEFAULT_WORKSPACE_PURPOSES.map((p) => p.toLowerCase()))
  const custom: string[] = []
  for (const item of items) {
    const purpose = normalizeWorkspacePurpose(item.purpose)
    if (purpose && !seen.has(purpose.toLowerCase())) {
      seen.add(purpose.toLowerCase())
      custom.push(purpose)
    }
  }
  custom.sort((a, b) => a.localeCompare(b))
  return [...DEFAULT_WORKSPACE_PURPOSES, ...custom]
}
