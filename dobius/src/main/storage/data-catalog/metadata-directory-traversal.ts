import { BoundedOperationError, runBounded } from './registered-roots'
import type { CatalogEntry, CatalogScanLimits, RegisteredCatalogRoot } from './types'
import {
  compareComponents,
  copyPagePreviewWitnesses,
  makeEntry,
  makePreviewWitness,
  normalizeRelativePath
} from './metadata-entry-projection'
import {
  closeHandle,
  closeMetadataScan,
  metadataScanErrorReason,
  sameIdentity,
  MetadataRootChangedError
} from './metadata-directory-handles'
import type {
  MetadataEntryStat,
  MetadataFileSystem,
  MetadataPage,
  MetadataScan
} from './metadata-scanner'

export {
  closeHandle,
  closeMetadataScan,
  MetadataRootChangedError,
  RaceSafetyUnavailableError,
  sameIdentity
} from './metadata-directory-handles'
const MAX_BUFFERED_DIRECTORY_NAME_BYTES = 2 * 1024 * 1024

export async function advanceMetadataScan(
  root: RegisteredCatalogRoot,
  scan: MetadataScan,
  limits: CatalogScanLimits,
  now: () => number,
  signal: AbortSignal | undefined,
  fileSystem: MetadataFileSystem,
  wallClockNow: () => number = Date.now
): Promise<MetadataPage> {
  const entries: CatalogEntry[] = []
  const startedAt = now()
  let responseBytes = 0
  let operations = 0
  let reason: MetadataPage['reason'] = null
  const budgetEnded = () =>
    entries.length >= limits.pageSize ||
    operations >= limits.maxOperationsPerPage ||
    now() - startedAt >= limits.maxElapsedMs
  const bounded = <T>(
    operation: () => Promise<T>,
    onLateValue?: (value: T) => void | Promise<void>
  ) => {
    const remainingMs = limits.maxElapsedMs - (now() - startedAt)
    if (remainingMs <= 0) {
      return Promise.reject(new BoundedOperationError('timeout'))
    }
    return runBounded(operation, remainingMs, signal, onLateValue)
  }

  try {
    while (scan.frames.length > 0 && !budgetEnded()) {
      if (signal?.aborted) {
        await closeMetadataScan(scan)
        return {
          entries,
          done: true,
          reason: 'cancelled',
          scannedEntries: scan.visited,
          previewWitnesses: new Map()
        }
      }
      const frame = scan.frames.at(-1)!
      for (const ancestor of scan.frames) {
        const verified = ancestor.parentHandle
          ? await bounded(() =>
              fileSystem.verifyChild(
                ancestor.parentHandle!,
                ancestor.componentName!,
                ancestor.identity
              )
            )
          : await bounded(() => fileSystem.verifyRoot(root, ancestor.handle))
        operations += 1
        if (!verified || !sameIdentity(ancestor.handle.identity, ancestor.identity)) {
          throw new MetadataRootChangedError(
            'Directory component or opened descriptor changed during scan.'
          )
        }
      }
      if (frame.names === null) {
        const names: string[] = []
        let directoryDone = false
        while (!directoryDone && !budgetEnded()) {
          const dirent = await bounded(() => frame.handle.read())
          operations += 1
          if (!dirent) {
            directoryDone = true
            break
          }
          scan.visited += 1
          if (scan.visited > limits.maxEntries) {
            reason = 'scan_limit'
            break
          }
          const nameBytes = Buffer.byteLength(dirent.name)
          if (
            nameBytes > 255 ||
            scan.bufferedNameBytes + nameBytes > MAX_BUFFERED_DIRECTORY_NAME_BYTES
          ) {
            reason = 'scan_limit'
            break
          }
          names.push(dirent.name)
          scan.bufferedNameBytes += nameBytes
        }
        if (reason) {
          scan.bufferedNameBytes -= names.reduce((sum, name) => sum + Buffer.byteLength(name), 0)
          break
        }
        if (!directoryDone) {
          scan.bufferedNameBytes -= names.reduce((sum, name) => sum + Buffer.byteLength(name), 0)
          reason = 'scan_limit'
          break
        }
        names.sort(compareComponents)
        const siblingKeys = new Set<string>()
        for (const name of names) {
          const key = `${frame.relativePath ? `${frame.relativePath}/` : ''}${name}`
            .normalize('NFC')
            .toLowerCase()
          if (siblingKeys.has(key)) {
            scan.bufferedNameBytes -= names.reduce(
              (sum, component) => sum + Buffer.byteLength(component),
              0
            )
            reason = 'ambiguous_path'
            break
          }
          siblingKeys.add(key)
        }
        if (reason) {
          break
        }
        frame.names = names
      }
      if (frame.nextName >= frame.names.length) {
        scan.bufferedNameBytes -= frame.names.reduce(
          (sum, name) => sum + Buffer.byteLength(name),
          0
        )
        frame.names = null
        await closeHandle(frame.handle)
        scan.frames.pop()
        continue
      }
      const name = frame.names[frame.nextName++]
      if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
        scan.partial = true
        continue
      }
      const relativePath = frame.relativePath ? `${frame.relativePath}/${name}` : name
      const normalizedPath = normalizeRelativePath(relativePath)
      if (
        !normalizedPath ||
        normalizedPath === '.' ||
        normalizedPath.startsWith('../') ||
        normalizedPath.length > 1024
      ) {
        scan.partial = true
        continue
      }
      let stat: MetadataEntryStat
      try {
        stat = await bounded(() => fileSystem.lstatChild(frame.handle, name))
      } catch (error) {
        if (error instanceof BoundedOperationError) {
          throw error
        }
        scan.partial = true
        continue
      }
      operations += 1
      if (stat.kind === 'symlink' || stat.kind === 'fifo' || stat.kind === 'special') {
        scan.partial = true
        continue
      }
      if (stat.identity.dev !== root.identity.dev) {
        scan.partial = true
        continue
      }
      const entry = makeEntry(root, relativePath, stat, Math.max(0, wallClockNow()))
      const collisionKey = entry.relativePath.normalize('NFC').toLowerCase()
      if (scan.entryIds.has(entry.entryId) || scan.collisionKeys.has(collisionKey)) {
        entries.length = 0
        reason = 'ambiguous_path'
        break
      }
      const entryBytes = Buffer.byteLength(JSON.stringify(entry))
      if (responseBytes + entryBytes > limits.maxResponseBytes) {
        reason = 'response_limit'
        break
      }
      responseBytes += entryBytes
      scan.entryIds.add(entry.entryId)
      scan.collisionKeys.add(collisionKey)
      entries.push(entry)
      if (stat.kind === 'file' && stat.previewIdentity && /\.(?:md|txt)$/i.test(name)) {
        try {
          const witness = makePreviewWitness(root, relativePath, stat, entry)
          if (witness) {
            scan.previewWitnesses.set(entry.entryId, witness)
          }
        } catch {
          // An invalid optional native witness disables preview for this row only.
        }
      }
      if (stat.kind === 'directory') {
        if (frame.depth >= limits.maxDepth || scan.frames.length >= limits.maxFrontier) {
          scan.partial = true
          reason = 'scan_limit'
          break
        }
        const child = await bounded(
          () => fileSystem.openChildDirectory(frame.handle, name),
          closeHandle
        )
        operations += 1
        if (!sameIdentity(child.identity, stat.identity)) {
          await closeHandle(child)
          throw new MetadataRootChangedError(
            'Opened child descriptor does not match its parent entry.'
          )
        }
        scan.frames.push({
          relativePath,
          depth: frame.depth + 1,
          identity: child.identity,
          handle: child,
          parentHandle: frame.handle,
          componentName: name,
          names: null,
          nextName: 0
        })
      }
    }
  } catch (error) {
    reason = metadataScanErrorReason(error)
  }

  if (reason) {
    if (reason === 'ambiguous_path') {
      entries.length = 0
    }
    const previewWitnesses = copyPagePreviewWitnesses(entries, scan)
    await closeMetadataScan(scan)
    return { entries, done: true, reason, scannedEntries: scan.visited, previewWitnesses }
  }
  const done = scan.frames.length === 0
  const previewWitnesses = copyPagePreviewWitnesses(entries, scan)
  if (done) {
    await closeMetadataScan(scan)
  }
  return {
    entries,
    done,
    reason: scan.partial ? 'filesystem_error' : null,
    scannedEntries: scan.visited,
    previewWitnesses
  }
}
