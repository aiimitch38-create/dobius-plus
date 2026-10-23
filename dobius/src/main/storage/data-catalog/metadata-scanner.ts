import { runBounded } from './registered-roots'
import type {
  NativePreviewChunk,
  NativePreviewIdentity,
  NativePreviewStat
} from './descriptor-preview-contract'
import {
  closeHandle,
  sameIdentity,
  MetadataRootChangedError,
  RaceSafetyUnavailableError
} from './metadata-directory-traversal'
export {
  advanceMetadataScan,
  closeMetadataScan,
  MetadataRootChangedError,
  RaceSafetyUnavailableError
} from './metadata-directory-traversal'
import type {
  CatalogEntry,
  CatalogFileIdentity,
  CatalogRootIdentity,
  CatalogResult,
  RegisteredCatalogRoot
} from './types'

export type MetadataDirectoryHandle = {
  /** Identity obtained from the opened descriptor itself. */
  identity: CatalogFileIdentity
  read(): Promise<{ name: string } | null>
  close(): Promise<void>
}

export type MetadataEntryStat = {
  kind: 'file' | 'directory' | 'symlink' | 'fifo' | 'special'
  identity: CatalogFileIdentity
  size: number
  modifiedAtMs: number
  /** Full-width native values retained privately for eligible preview witnesses. */
  previewIdentity?: NativePreviewIdentity
}

export type CatalogPreviewWitness = {
  entryId: string
  rootId: string
  generation: string
  components: string[]
  stat: NativePreviewStat
}

/**
 * A platform adapter must use descriptor-relative, no-follow operations for
 * every child. Path-only Node fs operations do not satisfy this contract.
 */
export type MetadataFileSystem = {
  supportsRaceSafeDirectoryHandles: boolean
  /** Synchronously changes whenever the owned native bridge/helper is replaced or invalidated. */
  previewHelperEpoch?(): string | number | null
  /** Native root incarnation proof; path stats and birth time alone are insufficient. */
  captureRootIdentity?(path: string): Promise<CatalogRootIdentity>
  openRoot(root: RegisteredCatalogRoot): Promise<MetadataDirectoryHandle>
  verifyRoot(root: RegisteredCatalogRoot, handle: MetadataDirectoryHandle): Promise<boolean>
  lstatChild(parent: MetadataDirectoryHandle, name: string): Promise<MetadataEntryStat>
  openChildDirectory(
    parent: MetadataDirectoryHandle,
    name: string
  ): Promise<MetadataDirectoryHandle>
  verifyChild(
    parent: MetadataDirectoryHandle,
    name: string,
    expectedIdentity: CatalogFileIdentity
  ): Promise<boolean>
  statPreview?(
    root: RegisteredCatalogRoot,
    openedRoot: MetadataDirectoryHandle,
    components: readonly string[]
  ): Promise<NativePreviewStat>
  readPreviewChunk?(
    root: RegisteredCatalogRoot,
    openedRoot: MetadataDirectoryHandle,
    components: readonly string[],
    expectedStat: NativePreviewStat,
    offset: number,
    length: number
  ): Promise<NativePreviewChunk>
}

/** Stock Node's public fs API has no portable, descriptor-relative readdir contract. */
export const defaultMetadataFileSystem: MetadataFileSystem = {
  supportsRaceSafeDirectoryHandles: false,
  async openRoot() {
    throw new RaceSafetyUnavailableError('A native descriptor-relative adapter is required.')
  },
  async verifyRoot() {
    return false
  },
  async lstatChild() {
    throw new RaceSafetyUnavailableError('A native descriptor-relative adapter is required.')
  },
  async openChildDirectory() {
    throw new RaceSafetyUnavailableError('A native descriptor-relative adapter is required.')
  },
  async verifyChild() {
    return false
  }
}

export type DirectoryFrame = {
  relativePath: string
  depth: number
  identity: CatalogFileIdentity
  handle: MetadataDirectoryHandle
  parentHandle: MetadataDirectoryHandle | null
  componentName: string | null
  names: string[] | null
  nextName: number
}

export type MetadataScan = {
  frames: DirectoryFrame[]
  visited: number
  entryIds: Set<string>
  collisionKeys: Set<string>
  partial: boolean
  closed: boolean
  bufferedNameBytes: number
  previewWitnesses: Map<string, CatalogPreviewWitness>
}

export type MetadataPage = {
  entries: CatalogEntry[]
  done: boolean
  reason: CatalogResult['reason']
  scannedEntries: number
  previewWitnesses: ReadonlyMap<string, CatalogPreviewWitness>
}
export async function startMetadataScan(
  root: RegisteredCatalogRoot,
  fileSystem: MetadataFileSystem = defaultMetadataFileSystem,
  options: { operationTimeoutMs?: number; signal?: AbortSignal } = {}
): Promise<MetadataScan> {
  if (!fileSystem.supportsRaceSafeDirectoryHandles) {
    throw new RaceSafetyUnavailableError(
      'This platform has no descriptor-relative directory adapter; the scan was refused.'
    )
  }
  const timeoutMs = options.operationTimeoutMs ?? 1000
  const handle = await runBounded(
    () => fileSystem.openRoot(root),
    timeoutMs,
    options.signal,
    closeHandle
  )
  try {
    if (!sameIdentity(handle.identity, root.identity)) {
      throw new MetadataRootChangedError(
        'Opened root handle does not match its registered identity.'
      )
    }
    const verified = await runBounded(
      () => fileSystem.verifyRoot(root, handle),
      timeoutMs,
      options.signal
    )
    if (!verified) {
      throw new MetadataRootChangedError('Registered root path changed during open.')
    }
    return {
      frames: [
        {
          relativePath: '',
          depth: 0,
          identity: handle.identity,
          handle,
          parentHandle: null,
          componentName: null,
          names: null,
          nextName: 0
        }
      ],
      visited: 0,
      entryIds: new Set(),
      collisionKeys: new Set(),
      partial: false,
      closed: false,
      bufferedNameBytes: 0,
      previewWitnesses: new Map()
    }
  } catch (error) {
    await closeHandle(handle)
    throw error
  }
}
