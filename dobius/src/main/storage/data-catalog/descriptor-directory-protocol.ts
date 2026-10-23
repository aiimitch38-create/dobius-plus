import {
  CatalogRootIdentitySchema,
  type CatalogFileIdentity,
  type CatalogRootIdentity
} from './types'
import type { MetadataEntryStat } from './metadata-scanner'
import {
  parseNativePreviewIdentity,
  type NativePreviewIdentity
} from './descriptor-preview-contract'

export const DIRECTORY_BRIDGE_WIRE_LIMIT = 64 * 1024
export const DIRECTORY_BRIDGE_PENDING_LIMIT = 256
export const DIRECTORY_BRIDGE_TIMEOUT_LIMIT = 5000

export type DirectoryBridgeRequest = {
  id: string
  op: string
  [key: string]: unknown
}

export type DirectoryBridgeReply = {
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

export class DescriptorDirectoryBridgeError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'DescriptorDirectoryBridgeError'
  }
}

export function parseDirectoryBridgeIdentity(value: unknown): CatalogFileIdentity {
  const identity = value as CatalogFileIdentity | null
  if (
    !identity ||
    typeof identity.dev !== 'string' ||
    typeof identity.ino !== 'string' ||
    !/^\d{1,64}$/.test(identity.dev) ||
    !/^\d{1,64}$/.test(identity.ino)
  ) {
    throw new DescriptorDirectoryBridgeError('Invalid bridge identity.', 'protocol')
  }
  return { dev: identity.dev, ino: identity.ino }
}

export function parseDirectoryBridgeRootIdentity(value: unknown): CatalogRootIdentity {
  const parsed = CatalogRootIdentitySchema.safeParse(value)
  if (!parsed.success) {
    throw new DescriptorDirectoryBridgeError('Invalid bridge root identity.', 'protocol')
  }
  return parsed.data
}

export function parseDirectoryBridgeHandle(value: unknown): {
  id: string
  identity: CatalogFileIdentity
} {
  const result = value as { handleId?: unknown; identity?: unknown } | null
  if (!result || typeof result.handleId !== 'string' || !/^\d{1,32}$/.test(result.handleId)) {
    throw new DescriptorDirectoryBridgeError('Invalid bridge handle.', 'protocol')
  }
  return { id: result.handleId, identity: parseDirectoryBridgeIdentity(result.identity) }
}

export function isDirectoryBridgeReply(value: unknown): value is DirectoryBridgeReply {
  if (!value || typeof value !== 'object') {
    return false
  }
  const reply = value as Record<string, unknown>
  return (
    typeof reply.id === 'string' &&
    typeof reply.ok === 'boolean' &&
    (reply.error === undefined || typeof reply.error === 'string')
  )
}

export type DirectoryBridgeEntryStat = MetadataEntryStat & {
  previewIdentity?: NativePreviewIdentity
}

export function parseDirectoryBridgeStat(value: unknown): DirectoryBridgeEntryStat {
  const stat = value as Record<string, unknown> | null
  if (
    !stat ||
    !['file', 'directory', 'symlink', 'fifo', 'special'].includes(String(stat.kind)) ||
    !Number.isSafeInteger(stat.size) ||
    (stat.size as number) < 0 ||
    typeof stat.modifiedAtMs !== 'number' ||
    !Number.isFinite(stat.modifiedAtMs) ||
    stat.modifiedAtMs < 0
  ) {
    throw new DescriptorDirectoryBridgeError('Invalid bridge metadata.', 'protocol')
  }
  let previewIdentity: NativePreviewIdentity | undefined
  if (stat.previewIdentity !== undefined) {
    try {
      previewIdentity = parseNativePreviewIdentity(stat.previewIdentity)
    } catch {
      throw new DescriptorDirectoryBridgeError('Invalid private preview identity.', 'protocol')
    }
    const identity = parseDirectoryBridgeIdentity(stat.identity)
    if (
      stat.kind !== 'file' ||
      previewIdentity.dev !== identity.dev ||
      previewIdentity.ino !== identity.ino ||
      BigInt(previewIdentity.sizeBytes) !== BigInt(stat.size as number) ||
      Number(BigInt(previewIdentity.mtimeNs) / 1_000_000n) !== stat.modifiedAtMs
    ) {
      throw new DescriptorDirectoryBridgeError('Mismatched private preview identity.', 'protocol')
    }
  }
  return {
    kind: stat.kind as MetadataEntryStat['kind'],
    identity: parseDirectoryBridgeIdentity(stat.identity),
    size: stat.size as number,
    modifiedAtMs: stat.modifiedAtMs,
    ...(previewIdentity ? { previewIdentity } : {})
  }
}
