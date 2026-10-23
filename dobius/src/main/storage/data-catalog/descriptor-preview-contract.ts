import { createHash } from 'node:crypto'
import type { CatalogRootIdentity, RegisteredCatalogRoot } from './types'
import type { MetadataDirectoryHandle } from './metadata-scanner'

export const DESCRIPTOR_PREVIEW_MAX_FILE_BYTES = 256 * 1024
export const DESCRIPTOR_PREVIEW_MAX_CHUNK_BYTES = 16 * 1024
const MAX_U64 = 0xffff_ffff_ffff_ffffn
const VERSION_DOMAIN = Buffer.from('dobius:data-catalog:preview-stat:v1\0', 'ascii')

export type DecimalU64 = string
export type NativePreviewIdentity = {
  dev: DecimalU64
  ino: DecimalU64
  sizeBytes: DecimalU64
  mtimeNs: DecimalU64
  ctimeNs: DecimalU64
  fileType: 'regular'
}
export type NativePreviewStat = NativePreviewIdentity & { fileVersion: string }
export type NativePreviewChunk = {
  stat: NativePreviewStat
  dataBase64: string
  offset: number
  nextOffset: number
  final: boolean
}

export type DescriptorPreviewFileSystem = {
  statPreview(
    root: RegisteredCatalogRoot,
    openedRoot: MetadataDirectoryHandle,
    components: readonly string[]
  ): Promise<NativePreviewStat>
  readPreviewChunk(
    root: RegisteredCatalogRoot,
    openedRoot: MetadataDirectoryHandle,
    components: readonly string[],
    expectedStat: NativePreviewStat,
    offset: number,
    length: number
  ): Promise<NativePreviewChunk>
}

function validDecimal(value: unknown): value is DecimalU64 {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) {
    return false
  }
  return BigInt(value) <= MAX_U64
}

function frame(hash: ReturnType<typeof createHash>, value: Uint8Array): void {
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(value.byteLength)
  hash.update(length)
  hash.update(value)
}

/** Opaque stat token; this is not a digest of file contents. */
export function previewFileVersion(
  rootId: string,
  generation: string,
  rootIdentity: CatalogRootIdentity,
  components: readonly string[],
  identity: NativePreviewIdentity
): string {
  if (
    !rootId ||
    Buffer.byteLength(rootId, 'utf8') > 256 ||
    !generation ||
    Buffer.byteLength(generation, 'utf8') > 256 ||
    components.length === 0 ||
    components.length > 64 ||
    components.some(
      (component) =>
        component === '' ||
        component === '.' ||
        component === '..' ||
        component.includes('/') ||
        component.includes('\0') ||
        Buffer.byteLength(component, 'utf8') > 255 ||
        Buffer.from(component, 'utf8').toString('utf8') !== component
    ) ||
    components.reduce((sum, component) => sum + Buffer.byteLength(component, 'utf8') + 1, 0) > 4096
  ) {
    throw new TypeError('Invalid preview stat-version input.')
  }
  const hash = createHash('sha256')
  hash.update(VERSION_DOMAIN)
  const values = [
    rootId,
    generation,
    rootIdentity.dev,
    rootIdentity.ino,
    rootIdentity.incarnation.provider,
    rootIdentity.incarnation.scope,
    rootIdentity.incarnation.token,
    String(components.length),
    ...components,
    identity.dev,
    identity.ino,
    identity.sizeBytes,
    identity.mtimeNs,
    identity.ctimeNs,
    identity.fileType
  ]
  for (const value of values) {
    frame(hash, Buffer.from(value, 'utf8'))
  }
  return hash.digest('hex')
}

export function parseNativePreviewIdentity(value: unknown): NativePreviewIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid native preview identity.')
  }
  const candidate = value as Record<string, unknown>
  if (
    Object.keys(candidate).sort().join(',') !== 'ctimeNs,dev,fileType,ino,mtimeNs,sizeBytes' ||
    candidate.fileType !== 'regular' ||
    !validDecimal(candidate.dev) ||
    !validDecimal(candidate.ino) ||
    candidate.ino === '0' ||
    !validDecimal(candidate.sizeBytes) ||
    !validDecimal(candidate.mtimeNs) ||
    !validDecimal(candidate.ctimeNs)
  ) {
    throw new TypeError('Invalid native preview identity.')
  }
  return {
    dev: candidate.dev,
    ino: candidate.ino,
    sizeBytes: candidate.sizeBytes,
    mtimeNs: candidate.mtimeNs,
    ctimeNs: candidate.ctimeNs,
    fileType: 'regular'
  }
}

export function parseNativePreviewStat(value: unknown): NativePreviewStat {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid native preview stat.')
  }
  const candidate = value as Record<string, unknown>
  if (
    Object.keys(candidate).sort().join(',') !==
    'ctimeNs,dev,fileType,fileVersion,ino,mtimeNs,sizeBytes'
  ) {
    throw new TypeError('Invalid native preview stat.')
  }
  const identity = parseNativePreviewIdentity({
    dev: candidate.dev,
    ino: candidate.ino,
    sizeBytes: candidate.sizeBytes,
    mtimeNs: candidate.mtimeNs,
    ctimeNs: candidate.ctimeNs,
    fileType: candidate.fileType
  })
  if (BigInt(identity.sizeBytes) > BigInt(DESCRIPTOR_PREVIEW_MAX_FILE_BYTES)) {
    throw new TypeError('Preview file exceeds the supported size.')
  }
  if (typeof candidate.fileVersion !== 'string' || !/^[0-9a-f]{64}$/.test(candidate.fileVersion)) {
    throw new TypeError('Invalid native preview stat version.')
  }
  return { ...identity, fileVersion: candidate.fileVersion }
}

export function parseNativePreviewChunk(value: unknown): NativePreviewChunk {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Invalid native preview chunk.')
  }
  const candidate = value as Record<string, unknown>
  if (
    Object.keys(candidate).sort().join(',') !== 'dataBase64,final,nextOffset,offset,stat' ||
    typeof candidate.dataBase64 !== 'string' ||
    !Number.isSafeInteger(candidate.offset) ||
    (candidate.offset as number) < 0 ||
    !Number.isSafeInteger(candidate.nextOffset) ||
    (candidate.nextOffset as number) < 0 ||
    typeof candidate.final !== 'boolean'
  ) {
    throw new TypeError('Invalid native preview chunk.')
  }
  const stat = parseNativePreviewStat(candidate.stat)
  const offset = candidate.offset as number
  const nextOffset = candidate.nextOffset as number
  const data = Buffer.from(candidate.dataBase64, 'base64')
  if (
    data.byteLength > DESCRIPTOR_PREVIEW_MAX_CHUNK_BYTES ||
    data.toString('base64') !== candidate.dataBase64 ||
    nextOffset !== offset + data.byteLength ||
    nextOffset > Number(BigInt(stat.sizeBytes)) ||
    candidate.final !== (nextOffset === Number(BigInt(stat.sizeBytes))) ||
    (data.byteLength === 0 && !candidate.final)
  ) {
    throw new TypeError('Invalid native preview chunk range.')
  }
  return { stat, dataBase64: candidate.dataBase64, offset, nextOffset, final: candidate.final }
}

export type DescriptorPreviewRoot = Pick<RegisteredCatalogRoot, 'id' | 'generation' | 'identity'>
