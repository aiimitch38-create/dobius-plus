import { createHash } from 'node:crypto'
import { basename, posix } from 'node:path'
import type { CatalogEntry, RegisteredCatalogRoot } from './types'
import type { CatalogPreviewWitness, MetadataEntryStat, MetadataScan } from './metadata-scanner'
import { parseNativePreviewIdentity, previewFileVersion } from './descriptor-preview-contract'

export function copyPagePreviewWitnesses(
  entries: readonly CatalogEntry[],
  scan: MetadataScan
): ReadonlyMap<string, CatalogPreviewWitness> {
  return new Map(
    entries.flatMap((entry) => {
      const witness = scan.previewWitnesses.get(entry.entryId)
      return witness ? [[entry.entryId, witness] as const] : []
    })
  )
}

export function normalizeRelativePath(value: string): string {
  return posix.normalize(value.normalize('NFC'))
}

export function compareComponents(left: string, right: string): number {
  const a = left.normalize('NFC'),
    b = right.normalize('NFC')
  return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0
}

export function makeEntry(
  root: RegisteredCatalogRoot,
  relativePath: string,
  stat: MetadataEntryStat,
  observedAtMs: number
): CatalogEntry {
  const identityPath = normalizeRelativePath(relativePath)
  const entryId = createHash('sha256').update(`${root.id}\0${identityPath}`).digest('hex')
  return {
    entryId,
    rootId: root.id,
    relativePath,
    name: basename(relativePath),
    kind: stat.kind === 'directory' ? 'directory' : 'file',
    sizeBytes: Number.isSafeInteger(stat.size) && stat.size >= 0 ? stat.size : null,
    modifiedAtMs:
      Number.isFinite(stat.modifiedAtMs) && stat.modifiedAtMs >= 0 ? stat.modifiedAtMs : null,
    contentDigestSha256: null,
    backupCoverage: 'unknown',
    availability: 'available',
    observedAtMs
  }
}

export function makePreviewWitness(
  root: RegisteredCatalogRoot,
  relativePath: string,
  stat: MetadataEntryStat,
  entry: CatalogEntry
): CatalogPreviewWitness | null {
  if (stat.kind !== 'file' || !stat.previewIdentity || !/\.(?:md|txt)$/i.test(entry.name)) {
    return null
  }
  try {
    const identity = parseNativePreviewIdentity(stat.previewIdentity)
    if (
      identity.dev !== stat.identity.dev ||
      identity.ino !== stat.identity.ino ||
      BigInt(identity.sizeBytes) !== BigInt(stat.size)
    ) {
      return null
    }
    const components = relativePath.split('/')
    return {
      entryId: entry.entryId,
      rootId: root.id,
      generation: root.generation,
      components,
      stat: {
        ...identity,
        fileVersion: previewFileVersion(
          root.id,
          root.generation,
          root.identity,
          components,
          identity
        )
      }
    }
  } catch {
    // An invalid optional native witness disables preview for this row only.
    return null
  }
}
