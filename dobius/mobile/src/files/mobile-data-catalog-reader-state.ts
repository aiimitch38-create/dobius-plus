import {
  DataCatalogRootsResult,
  type DataCatalogRootView
} from '../../../src/shared/data-catalog-roots'
import {
  CatalogResultSchema,
  type CatalogEntry,
  type CatalogResult
} from '../../../src/shared/data-catalog-schema'

export type MobileCatalogRootsState = {
  phase: 'idle' | 'loading' | 'ready' | 'denied' | 'unavailable'
  roots: DataCatalogRootView[]
  error: string | null
}

export type MobileCatalogPageState = {
  phase: 'idle' | 'loading' | 'complete' | 'partial' | 'denied' | 'unavailable'
  entries: CatalogEntry[]
  cursor: string | null
  reason: CatalogResult['reason'] | null
  error: string | null
}

export const EMPTY_MOBILE_CATALOG_ROOTS: MobileCatalogRootsState = {
  phase: 'idle',
  roots: [],
  error: null
}

export const EMPTY_MOBILE_CATALOG_PAGE: MobileCatalogPageState = {
  phase: 'idle',
  entries: [],
  cursor: null,
  reason: null,
  error: null
}

export const MOBILE_CATALOG_PAGE_SIZE = 100
export const MOBILE_CATALOG_MAX_LOADED_ENTRIES = 1000

export function parseMobileCatalogRoots(value: unknown): MobileCatalogRootsState | null {
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

export function parseMobileCatalogPage(
  value: unknown,
  expectedRootId: string,
  previousEntries: CatalogEntry[] = []
): MobileCatalogPageState {
  const parsed = CatalogResultSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ...EMPTY_MOBILE_CATALOG_PAGE,
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
      ...EMPTY_MOBILE_CATALOG_PAGE,
      phase: 'unavailable',
      error: 'The catalog returned data for a different folder.'
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
          ? 'This catalog page expired. Refresh the folder to start a new listing.'
          : result.state === 'unavailable'
            ? 'Catalog is unavailable on this host.'
            : null
    }
  }
  const combinedEntries = [...previousEntries, ...result.entries]
  const capped =
    combinedEntries.length > MOBILE_CATALOG_MAX_LOADED_ENTRIES ||
    (result.cursor !== null && combinedEntries.length >= MOBILE_CATALOG_MAX_LOADED_ENTRIES)
  return {
    phase: capped ? 'partial' : result.state,
    entries: combinedEntries.slice(0, MOBILE_CATALOG_MAX_LOADED_ENTRIES),
    cursor: capped ? null : result.cursor,
    reason: capped ? 'response_limit' : result.reason,
    error: null
  }
}

export function unavailableMobileCatalogPage(
  error: unknown,
  previous: MobileCatalogPageState = EMPTY_MOBILE_CATALOG_PAGE
): MobileCatalogPageState {
  return {
    ...previous,
    phase: 'unavailable',
    error: error instanceof Error ? error.message : 'Catalog is unavailable on this host.'
  }
}
