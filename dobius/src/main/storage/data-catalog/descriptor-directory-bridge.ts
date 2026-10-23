import type { CatalogFileIdentity, CatalogRootIdentity, RegisteredCatalogRoot } from './types'
import type { MetadataDirectoryHandle, MetadataFileSystem } from './metadata-scanner'
import {
  DescriptorDirectoryBridgeError,
  type DirectoryBridgeEntryStat,
  parseDirectoryBridgeHandle,
  parseDirectoryBridgeRootIdentity,
  parseDirectoryBridgeStat
} from './descriptor-directory-protocol'
import type { DescriptorPreviewFileSystem } from './descriptor-preview-contract'
import { createDescriptorPreviewBridgeOperations } from './descriptor-preview-bridge-operations'
import {
  DescriptorDirectoryTransport,
  type DescriptorDirectoryTransportOptions
} from './descriptor-directory-transport'

export { DescriptorDirectoryBridgeError } from './descriptor-directory-protocol'
export type { DescriptorDirectoryTransportOptions } from './descriptor-directory-transport'

class DirectoryHandle implements MetadataDirectoryHandle {
  private closed = false

  constructor(
    readonly transport: DescriptorDirectoryTransport,
    readonly id: string,
    readonly identity: CatalogFileIdentity,
    readonly isRoot = false
  ) {}

  read(): Promise<{ name: string } | null> {
    if (this.closed) {
      return Promise.reject(
        new DescriptorDirectoryBridgeError('Handle is closed.', 'invalid_handle')
      )
    }
    return validateResult(
      this.transport,
      this.transport.request('read', { handleId: this.id }),
      (value) => {
        if (value === null) {
          return null
        }
        const result = value as { name?: unknown } | null
        if (
          !result ||
          typeof result.name !== 'string' ||
          result.name === '' ||
          result.name === '.' ||
          result.name === '..' ||
          result.name.includes('/') ||
          result.name.includes('\0') ||
          Buffer.byteLength(result.name, 'utf8') > 255
        ) {
          throw new DescriptorDirectoryBridgeError('Invalid directory entry.', 'protocol')
        }
        return { name: result.name }
      }
    )
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      await this.transport.request('close', { handleId: this.id })
    }
  }
}

export function createDescriptorDirectoryBridge(
  options: DescriptorDirectoryTransportOptions
): MetadataFileSystem &
  DescriptorPreviewFileSystem & {
    captureRootIdentity(path: string): Promise<CatalogRootIdentity>
    previewHelperEpoch(): string | null
    cancel(): Promise<void>
    dispose(): Promise<void>
    readonly cleanupConfirmed: boolean
  } {
  const supported = process.platform === 'linux' || process.platform === 'darwin'
  let transport = new DescriptorDirectoryTransport(options)
  let disposed = false
  const unsupported = () =>
    new DescriptorDirectoryBridgeError('POSIX bridge unavailable.', 'unsupported')
  const unavailable = () =>
    new DescriptorDirectoryBridgeError('Bridge is unavailable.', 'unavailable')

  // A failed epoch can be replaced only after its owned process is observed
  // gone. Handles never migrate: each one keeps its transport instance.
  const transportForNewRootOperation = (): DescriptorDirectoryTransport => {
    if (disposed || transport.isClosing) {
      throw unavailable()
    }
    if (transport.isDead) {
      if (!transport.cleanupConfirmed) {
        throw unavailable()
      }
      transport = new DescriptorDirectoryTransport(options)
    }
    return transport
  }
  const transportForHandle = (handle: MetadataDirectoryHandle): DescriptorDirectoryTransport => {
    if (!(handle instanceof DirectoryHandle) || handle.transport !== transport) {
      throw unsupported()
    }
    return handle.transport
  }
  const rootHandleId = (handle: MetadataDirectoryHandle): string => {
    const owner = transportForHandle(handle)
    if (!(handle instanceof DirectoryHandle) || !handle.isRoot) {
      throw new DescriptorDirectoryBridgeError('A root handle is required.', 'protocol')
    }
    if (owner !== transport) {
      throw unavailable()
    }
    return handle.id
  }
  const handleId = (handle: MetadataDirectoryHandle) => {
    transportForHandle(handle)
    return (handle as DirectoryHandle).id
  }
  const open = async (
    owner: DescriptorDirectoryTransport,
    op: string,
    args: Record<string, unknown>,
    isRoot = false
  ) => {
    try {
      const handle = parseDirectoryBridgeHandle(await owner.request(op, args))
      return new DirectoryHandle(owner, handle.id, handle.identity, isRoot)
    } catch (error) {
      if (error instanceof DescriptorDirectoryBridgeError && error.code === 'protocol') {
        await owner.cancel()
      }
      throw error
    }
  }
  const booleanRequest = (
    owner: DescriptorDirectoryTransport,
    op: string,
    args: Record<string, unknown>
  ) =>
    validateResult(owner, owner.request(op, args), (value) => {
      if (typeof value !== 'boolean') {
        throw new DescriptorDirectoryBridgeError('Invalid bridge result.', 'protocol')
      }
      return value
    })
  const checkPlatform = () => {
    if (!supported) {
      throw unsupported()
    }
  }

  return {
    ...createDescriptorPreviewBridgeOperations(transportForHandle, rootHandleId),
    supportsRaceSafeDirectoryHandles: supported,
    previewHelperEpoch() {
      if (!supported || disposed) {
        return null
      }
      return transport.previewHelperEpoch
    },
    async captureRootIdentity(path: string) {
      checkPlatform()
      const owner = transportForNewRootOperation()
      return validateResult(
        owner,
        owner.request('capture_root_identity', { path }),
        parseDirectoryBridgeRootIdentity
      )
    },
    async openRoot(root: RegisteredCatalogRoot) {
      checkPlatform()
      const owner = transportForNewRootOperation()
      return open(
        owner,
        'open_root',
        {
          path: root.canonicalPath,
          identity: root.identity
        },
        true
      )
    },
    async verifyRoot(root: RegisteredCatalogRoot, handle: MetadataDirectoryHandle) {
      checkPlatform()
      const owner = transportForHandle(handle)
      return booleanRequest(owner, 'verify_root', {
        path: root.canonicalPath,
        identity: root.identity,
        handleId: handleId(handle)
      })
    },
    async lstatChild(
      parent: MetadataDirectoryHandle,
      name: string
    ): Promise<DirectoryBridgeEntryStat> {
      const owner = transportForHandle(parent)
      try {
        return parseDirectoryBridgeStat(
          await owner.request('lstat_child', { parentHandleId: handleId(parent), name })
        )
      } catch (error) {
        if (error instanceof DescriptorDirectoryBridgeError && error.code === 'protocol') {
          await owner.cancel()
        }
        throw error
      }
    },
    openChildDirectory(parent: MetadataDirectoryHandle, name: string) {
      const owner = transportForHandle(parent)
      return open(owner, 'open_child', { parentHandleId: handleId(parent), name })
    },
    verifyChild(parent: MetadataDirectoryHandle, name: string, identity: CatalogFileIdentity) {
      const owner = transportForHandle(parent)
      return booleanRequest(owner, 'verify_child', {
        parentHandleId: handleId(parent),
        name,
        identity
      })
    },
    cancel: () => transport.cancel(),
    dispose: () => {
      disposed = true
      return transport.dispose()
    },
    get cleanupConfirmed() {
      return transport.cleanupConfirmed
    }
  }
}

async function validateResult<T>(
  transport: DescriptorDirectoryTransport,
  result: Promise<unknown>,
  parse: (value: unknown) => T
): Promise<T> {
  try {
    return parse(await result)
  } catch (error) {
    if (error instanceof DescriptorDirectoryBridgeError && error.code === 'protocol') {
      await transport.cancel()
    }
    throw error
  }
}
