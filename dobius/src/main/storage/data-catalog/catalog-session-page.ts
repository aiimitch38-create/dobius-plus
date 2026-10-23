import { randomBytes } from 'node:crypto'
import { CatalogResultSchema, type CatalogResult } from '../../../shared/data-catalog-schema'
import type { CatalogScanLimits } from './types'
import { advanceMetadataScan, closeMetadataScan, type MetadataFileSystem } from './metadata-scanner'
import type { CatalogPreviewPrincipal } from './preview-principal'
import type { CatalogPreviewWitness } from './metadata-scanner'
import { emptyCatalogResult } from './catalog-result'
import type { ScanSession } from './catalog-session-lifecycle'

export type CatalogSessionPageOperations = {
  release(session: ScanSession): void
  retain(cursor: string, session: ScanSession): void
  drop(cursor: string, session: ScanSession): Promise<void>
  enforceResponseLimit(result: CatalogResult): CatalogResult
  commitPage(
    result: CatalogResult,
    witnesses: ReadonlyMap<string, CatalogPreviewWitness>,
    principal?: CatalogPreviewPrincipal,
    callback?: (
      result: CatalogResult,
      witnesses: ReadonlyMap<string, CatalogPreviewWitness>
    ) => void
  ): CatalogResult
  authorizeAfterScan(): Promise<CatalogResult | null>
}

export async function runCatalogSessionPage(input: {
  session: ScanSession
  pageSize: number
  signal?: AbortSignal
  isClosed: () => boolean
  limits: CatalogScanLimits
  now: () => number
  wallClockNow: () => number
  fileSystem: MetadataFileSystem
  operations: CatalogSessionPageOperations
  previewPrincipal?: CatalogPreviewPrincipal
  onPageCommitted?: (
    result: CatalogResult,
    witnesses: ReadonlyMap<string, CatalogPreviewWitness>
  ) => void
}): Promise<CatalogResult> {
  const {
    session,
    pageSize,
    signal,
    isClosed,
    limits,
    now,
    wallClockNow,
    fileSystem,
    operations,
    previewPrincipal,
    onPageCommitted
  } = input
  if (isClosed() || signal?.aborted) {
    await closeMetadataScan(session.scan)
    operations.release(session)
    return emptyCatalogResult('unavailable', 'cancelled')
  }
  const page = await advanceMetadataScan(
    session.root,
    session.scan,
    { ...limits, pageSize },
    now,
    signal,
    fileSystem,
    wallClockNow
  )
  if (signal?.aborted || page.reason === 'cancelled' || isClosed()) {
    await closeMetadataScan(session.scan)
    operations.release(session)
    return emptyCatalogResult('unavailable', 'cancelled')
  }
  const authorizationFailure = await operations.authorizeAfterScan()
  if (authorizationFailure) {
    await closeMetadataScan(session.scan)
    operations.release(session)
    return authorizationFailure
  }
  if (page.reason !== null) {
    await closeMetadataScan(session.scan)
    operations.release(session)
    if (page.reason === 'root_changed') {
      return emptyCatalogResult('unavailable', 'root_changed')
    }
    if (page.reason === 'race_safety_unavailable') {
      return emptyCatalogResult('unavailable', 'race_safety_unavailable')
    }
    return operations.commitPage(
      operations.enforceResponseLimit(
        CatalogResultSchema.parse({
          state: 'partial',
          rootId: session.root.id,
          entries: page.reason === 'ambiguous_path' ? [] : page.entries,
          cursor: null,
          scannedEntries: page.scannedEntries,
          reason: page.reason
        })
      ),
      page.previewWitnesses,
      previewPrincipal,
      onPageCommitted
    )
  }
  if (page.done) {
    operations.release(session)
    return operations.commitPage(
      operations.enforceResponseLimit(
        CatalogResultSchema.parse({
          state: 'complete',
          rootId: session.root.id,
          entries: page.entries,
          cursor: null,
          scannedEntries: page.scannedEntries,
          reason: null
        })
      ),
      page.previewWitnesses,
      previewPrincipal,
      onPageCommitted
    )
  }

  const nextCursor = randomBytes(32).toString('base64url')
  operations.retain(nextCursor, session)
  const result = CatalogResultSchema.parse({
    state: 'partial',
    rootId: session.root.id,
    entries: page.entries,
    cursor: nextCursor,
    scannedEntries: page.scannedEntries,
    reason: null
  })
  if (Buffer.byteLength(JSON.stringify(result)) > limits.maxResponseBytes) {
    await operations.drop(nextCursor, session)
    return emptyCatalogResult('unavailable', 'response_limit')
  }
  return operations.commitPage(result, page.previewWitnesses, previewPrincipal, onPageCommitted)
}
