import type { CatalogResult } from '../../../shared/data-catalog-schema'
import type {
  CatalogRootIdentityReader,
  CatalogScanLimits,
  RegisteredCatalogRootProvider
} from './types'
import {
  closeMetadataScan,
  MetadataRootChangedError,
  RaceSafetyUnavailableError,
  startMetadataScan,
  type MetadataFileSystem,
  type MetadataScan
} from './metadata-scanner'
import type { CatalogPreviewPrincipal } from './preview-principal'
import type { CatalogPreviewWitness } from './metadata-scanner'
import {
  BoundedOperationError,
  resolveAuthorizedCatalogRoot,
  sameRegisteredRoot
} from './registered-roots'
import { emptyCatalogResult } from './catalog-result'
import type { CatalogSessionLifecycle, ScanSession } from './catalog-session-lifecycle'

export async function startCatalogSessionPage(input: {
  roots: RegisteredCatalogRootProvider
  limits: CatalogScanLimits
  now: () => number
  wallClockNow: () => number
  fileSystem: MetadataFileSystem
  rootIdentityReader?: CatalogRootIdentityReader
  lifecycle: CatalogSessionLifecycle
  principalId: string
  rootId: string
  pageSize: number
  signal: AbortSignal
  reservation: object
  isClosed: () => boolean
  previewPrincipal?: CatalogPreviewPrincipal
  onPageCommitted?: (
    result: CatalogResult,
    witnesses: ReadonlyMap<string, CatalogPreviewWitness>
  ) => void
}): Promise<CatalogResult> {
  const {
    roots,
    limits,
    now,
    wallClockNow,
    fileSystem,
    rootIdentityReader,
    lifecycle,
    principalId,
    rootId,
    pageSize,
    signal,
    reservation,
    isClosed,
    previewPrincipal,
    onPageCommitted
  } = input
  const authorization = await resolveAuthorizedCatalogRoot(
    roots,
    principalId,
    rootId,
    signal,
    limits.maxElapsedMs,
    rootIdentityReader
  )
  if (authorization.state === 'denied') {
    return emptyCatalogResult('denied', 'access_denied')
  }
  if (authorization.state !== 'authorized') {
    return emptyCatalogResult(
      'unavailable',
      authorization.state === 'changed' ? 'root_changed' : 'root_unavailable'
    )
  }
  let scan: MetadataScan
  try {
    scan = await startMetadataScan(authorization.root, fileSystem, {
      operationTimeoutMs: limits.maxElapsedMs,
      signal
    })
  } catch (error) {
    if (error instanceof RaceSafetyUnavailableError) {
      return emptyCatalogResult('unavailable', 'race_safety_unavailable')
    }
    if (error instanceof MetadataRootChangedError) {
      return emptyCatalogResult('unavailable', 'root_changed')
    }
    if (error instanceof BoundedOperationError) {
      return emptyCatalogResult(
        'unavailable',
        error.reason === 'cancelled' ? 'cancelled' : 'scan_limit'
      )
    }
    return emptyCatalogResult('unavailable', 'filesystem_error')
  }
  if (signal.aborted || isClosed()) {
    await closeMetadataScan(scan)
    return emptyCatalogResult('unavailable', 'cancelled')
  }
  const rechecked = await resolveAuthorizedCatalogRoot(
    roots,
    principalId,
    authorization.root.id,
    signal,
    limits.maxElapsedMs,
    rootIdentityReader
  )
  if (rechecked.state !== 'authorized' || !sameRegisteredRoot(authorization.root, rechecked.root)) {
    await closeMetadataScan(scan)
    return emptyCatalogResult(
      rechecked.state === 'denied' ? 'denied' : 'unavailable',
      rechecked.state === 'denied'
        ? 'access_denied'
        : rechecked.state === 'changed' || rechecked.state === 'authorized'
          ? 'root_changed'
          : 'root_unavailable'
    )
  }
  if (signal.aborted || isClosed()) {
    await closeMetadataScan(scan)
    return emptyCatalogResult('unavailable', 'cancelled')
  }
  const session: ScanSession = {
    principalId,
    root: authorization.root,
    scan,
    expiresAtMonotonic: now() + limits.sessionTtlMs,
    expiresAtWall: wallClockNow() + limits.sessionTtlMs,
    reservation
  }
  try {
    return await lifecycle.runPage(
      session,
      pageSize,
      signal,
      isClosed,
      previewPrincipal,
      onPageCommitted
    )
  } finally {
    if (!lifecycle.isSessionRetained(session)) {
      lifecycle.release(session)
    }
  }
}
