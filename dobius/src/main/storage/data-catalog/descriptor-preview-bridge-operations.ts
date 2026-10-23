import type { RegisteredCatalogRoot } from './types'
import type { MetadataDirectoryHandle } from './metadata-scanner'
import { DescriptorDirectoryBridgeError } from './descriptor-directory-protocol'
import {
  DESCRIPTOR_PREVIEW_MAX_CHUNK_BYTES,
  parseNativePreviewChunk,
  parseNativePreviewIdentity,
  parseNativePreviewStat,
  previewFileVersion,
  type DescriptorPreviewFileSystem,
  type NativePreviewStat
} from './descriptor-preview-contract'
import type { DescriptorDirectoryTransport } from './descriptor-directory-transport'

export function createDescriptorPreviewBridgeOperations(
  transportForHandle: (handle: MetadataDirectoryHandle) => DescriptorDirectoryTransport,
  rootHandleId: (handle: MetadataDirectoryHandle) => string
): DescriptorPreviewFileSystem {
  return {
    async statPreview(root, openedRoot, components) {
      validatePreviewComponents(components)
      const owner = transportForHandle(openedRoot)
      const raw = await owner.request('stat_preview', {
        rootHandleId: rootHandleId(openedRoot),
        rootId: root.id,
        generation: root.generation,
        components
      })
      return validatePreviewStat(owner, raw, root, components)
    },
    async readPreviewChunk(
      root: RegisteredCatalogRoot,
      openedRoot: MetadataDirectoryHandle,
      components: readonly string[],
      expectedStat: NativePreviewStat,
      offset: number,
      length: number
    ) {
      validatePreviewComponents(components)
      const normalizedExpected = parseNativePreviewStat(expectedStat)
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(length) ||
        length <= 0 ||
        length > DESCRIPTOR_PREVIEW_MAX_CHUNK_BYTES ||
        offset >= Number(BigInt(normalizedExpected.sizeBytes)) ||
        length !==
          Math.min(
            DESCRIPTOR_PREVIEW_MAX_CHUNK_BYTES,
            Number(BigInt(normalizedExpected.sizeBytes)) - offset
          )
      ) {
        throw new DescriptorDirectoryBridgeError('Invalid preview range.', 'protocol')
      }
      const owner = transportForHandle(openedRoot)
      try {
        const raw = await owner.request('read_preview_chunk', {
          rootHandleId: rootHandleId(openedRoot),
          rootId: root.id,
          generation: root.generation,
          components,
          expectedStat: normalizedExpected,
          offset,
          length
        })
        const chunk = parseNativePreviewChunk(raw)
        const statMatches = (Object.keys(normalizedExpected) as (keyof NativePreviewStat)[]).every(
          (key) => chunk.stat[key] === normalizedExpected[key]
        )
        const expectedVersion = previewFileVersion(
          root.id,
          root.generation,
          root.identity,
          components,
          {
            dev: normalizedExpected.dev,
            ino: normalizedExpected.ino,
            sizeBytes: normalizedExpected.sizeBytes,
            mtimeNs: normalizedExpected.mtimeNs,
            ctimeNs: normalizedExpected.ctimeNs,
            fileType: normalizedExpected.fileType
          }
        )
        if (
          chunk.stat.fileVersion !== expectedVersion ||
          chunk.stat.fileVersion !== normalizedExpected.fileVersion ||
          !statMatches ||
          chunk.offset !== offset ||
          chunk.nextOffset - chunk.offset !== length
        ) {
          throw new TypeError('Preview chunk does not match its request.')
        }
        return chunk
      } catch (error) {
        if (error instanceof DescriptorDirectoryBridgeError && error.code === 'protocol') {
          await owner.cancel()
          throw error
        }
        if (error instanceof TypeError) {
          await owner.cancel()
          throw new DescriptorDirectoryBridgeError('Invalid preview response.', 'protocol')
        }
        throw error
      }
    }
  }
}

function validatePreviewComponents(components: readonly string[]): void {
  if (
    !Array.isArray(components) ||
    components.length < 1 ||
    components.length > 64 ||
    components.some(
      (component) =>
        typeof component !== 'string' ||
        component === '' ||
        component === '.' ||
        component === '..' ||
        component.includes('/') ||
        component.includes('\0') ||
        Buffer.byteLength(component, 'utf8') > 255
    ) ||
    components.reduce((sum, component) => sum + Buffer.byteLength(component, 'utf8') + 1, 0) > 4096
  ) {
    throw new DescriptorDirectoryBridgeError('Invalid preview path components.', 'protocol')
  }
}

async function validatePreviewStat(
  transport: DescriptorDirectoryTransport,
  value: unknown,
  root: RegisteredCatalogRoot,
  components: readonly string[]
): Promise<NativePreviewStat> {
  try {
    const stat = parseNativePreviewStat(value)
    const identity = parseNativePreviewIdentity({
      dev: stat.dev,
      ino: stat.ino,
      sizeBytes: stat.sizeBytes,
      mtimeNs: stat.mtimeNs,
      ctimeNs: stat.ctimeNs,
      fileType: stat.fileType
    })
    if (
      stat.fileVersion !==
      previewFileVersion(root.id, root.generation, root.identity, components, identity)
    ) {
      throw new TypeError('Preview stat version mismatch.')
    }
    return stat
  } catch {
    await transport.cancel()
    throw new DescriptorDirectoryBridgeError('Invalid preview stat response.', 'protocol')
  }
}
