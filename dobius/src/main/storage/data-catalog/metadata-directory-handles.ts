import { BoundedOperationError, runBounded } from './registered-roots'
import type { CatalogFileIdentity } from './types'
import type { MetadataDirectoryHandle, MetadataScan, MetadataPage } from './metadata-scanner'

export class RaceSafetyUnavailableError extends Error {}
export class MetadataRootChangedError extends Error {}

export function sameIdentity(left: CatalogFileIdentity, right: CatalogFileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

export async function closeHandle(handle: MetadataDirectoryHandle): Promise<void> {
  await runBounded(() => handle.close(), 250).catch(() => undefined)
}

export async function closeMetadataScan(scan: MetadataScan): Promise<void> {
  if (scan.closed) {
    return
  }
  scan.closed = true
  const handles = scan.frames.splice(0).map(({ handle }) => handle)
  scan.bufferedNameBytes = 0
  scan.entryIds.clear()
  scan.collisionKeys.clear()
  scan.previewWitnesses.clear()
  await Promise.all(handles.map(closeHandle))
}

export const metadataScanErrorReason = (error: unknown): MetadataPage['reason'] =>
  error instanceof MetadataRootChangedError
    ? 'root_changed'
    : error instanceof RaceSafetyUnavailableError
      ? 'race_safety_unavailable'
      : error instanceof BoundedOperationError
        ? error.reason === 'cancelled'
          ? 'cancelled'
          : 'scan_limit'
        : 'filesystem_error'
