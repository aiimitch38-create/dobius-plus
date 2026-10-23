import {
  DataCatalogRootsResult,
  type DataCatalogRootView
} from '../../../../shared/data-catalog-roots'
import {
  CatalogResultSchema,
  type CatalogEntry,
  type CatalogResult
} from '../../../../shared/data-catalog-schema'
import type { RuntimeClientTarget } from '../../runtime/runtime-rpc-client'

export type DesktopCatalogTarget = RuntimeClientTarget | null

export type DesktopCatalogRootsState = {
  phase: 'idle' | 'loading' | 'ready' | 'denied' | 'unavailable'
  roots: DataCatalogRootView[]
  error: string | null
}

export type DesktopCatalogPageState = {
  phase: 'idle' | 'loading' | 'complete' | 'partial' | 'denied' | 'unavailable'
  entries: CatalogEntry[]
  cursor: string | null
  reason: CatalogResult['reason'] | null
  error: string | null
}

export const EMPTY_DESKTOP_CATALOG_ROOTS: DesktopCatalogRootsState = {
  phase: 'idle',
  roots: [],
  error: null
}

export const EMPTY_DESKTOP_CATALOG_PAGE: DesktopCatalogPageState = {
  phase: 'idle',
  entries: [],
  cursor: null,
  reason: null,
  error: null
}

export const DESKTOP_CATALOG_PAGE_SIZE = 100
export const DESKTOP_CATALOG_MAX_LOADED_ENTRIES = 1000

export function desktopCatalogTargetKey(target: DesktopCatalogTarget): string | null {
  if (!target) {
    return null
  }
  return target.kind === 'local' ? 'local' : `environment:${target.environmentId}`
}

export function desktopCatalogTargetForKey(key: string | null): RuntimeClientTarget | null {
  if (key === 'local') {
    return { kind: 'local' }
  }
  if (key?.startsWith('environment:')) {
    return { kind: 'environment', environmentId: key.slice('environment:'.length) }
  }
  return null
}

export function catalogTargetFromSelection(
  selection: string,
  registeredEnvironments: readonly { id: string }[]
): RuntimeClientTarget | null {
  if (selection === 'local') {
    return { kind: 'local' }
  }
  const environmentId = selection.startsWith('environment:')
    ? selection.slice('environment:'.length)
    : ''
  return environmentId &&
    registeredEnvironments.some((environment) => environment.id === environmentId)
    ? { kind: 'environment', environmentId }
    : null
}

export function parseDesktopCatalogRoots(value: unknown): DesktopCatalogRootsState | null {
  const parsed = DataCatalogRootsResult.safeParse(value)
  if (!parsed.success) {
    return null
  }
  return {
    phase: parsed.data.state,
    roots: parsed.data.roots,
    error: parsed.data.state === 'unavailable' ? 'Catalog is unavailable on this host.' : null
  }
}

export function parseDesktopCatalogPage(
  value: unknown,
  expectedRootId: string,
  previousEntries: CatalogEntry[] = []
): DesktopCatalogPageState {
  const parsed = CatalogResultSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ...EMPTY_DESKTOP_CATALOG_PAGE,
      phase: 'unavailable',
      error: 'The catalog response was invalid.'
    }
  }
  const result = parsed.data
  const terminal = result.state === 'denied' || result.state === 'unavailable'
  const emptyTerminal = terminal && result.entries.length === 0 && result.cursor === null
  if (
    (result.rootId !== null && result.rootId !== expectedRootId) ||
    (result.rootId === null && !emptyTerminal) ||
    (!terminal && result.entries.some((entry) => entry.rootId !== expectedRootId))
  ) {
    return {
      ...EMPTY_DESKTOP_CATALOG_PAGE,
      phase: 'unavailable',
      error: 'The catalog returned data for a different root.'
    }
  }
  if (terminal) {
    return {
      phase: result.state,
      entries: [],
      cursor: null,
      reason: result.reason,
      error:
        result.state === 'unavailable' &&
        (result.reason === 'expired' || result.reason === 'invalid_cursor')
          ? 'This catalog page expired. Refresh the root to start a new listing.'
          : result.state === 'unavailable'
            ? 'Catalog is unavailable on this host.'
            : null
    }
  }
  const combinedEntries = [...previousEntries, ...result.entries]
  const capped =
    combinedEntries.length > DESKTOP_CATALOG_MAX_LOADED_ENTRIES ||
    (result.cursor !== null && combinedEntries.length >= DESKTOP_CATALOG_MAX_LOADED_ENTRIES)
  return {
    phase: capped ? 'partial' : result.state,
    entries: combinedEntries.slice(0, DESKTOP_CATALOG_MAX_LOADED_ENTRIES),
    cursor: capped ? null : result.cursor,
    reason: capped ? 'response_limit' : result.reason,
    error: null
  }
}

export function unavailableDesktopCatalogPage(
  error: unknown,
  previous: DesktopCatalogPageState = EMPTY_DESKTOP_CATALOG_PAGE
): DesktopCatalogPageState {
  return {
    ...previous,
    phase: 'unavailable',
    error: error instanceof Error ? error.message : 'Catalog is unavailable on this host.'
  }
}
