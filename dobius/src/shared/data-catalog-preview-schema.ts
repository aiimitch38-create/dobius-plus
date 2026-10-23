import { z } from 'zod'
import { DataCatalogDeviceIds, DataCatalogRootId } from './data-catalog-roots'

const Uuid = z.string().uuid()
const FileVersion = z.string().regex(/^[a-f0-9]{64}$/)
const EntryReference = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
const PreviewSessionId = z.string().uuid()
function isBoundedDecimalBytes(value: string): boolean {
  if (value.length > 16 || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return false
  }
  return BigInt(value) <= 262_144n
}

const DecimalBytes = z
  .string()
  .refine(isBoundedDecimalBytes, 'Expected a canonical bounded byte count')

export const DataCatalogPreviewPolicyRequestSchema = z
  .object({ rootId: DataCatalogRootId, generation: Uuid })
  .strict()
export type DataCatalogPreviewPolicyRequest = z.infer<typeof DataCatalogPreviewPolicyRequestSchema>

const PreviewDeviceSchema = z.object({ deviceId: Uuid, name: z.string().min(1).max(128) }).strict()

export const DataCatalogPreviewPolicyResultSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('local'),
      desktopPreviewEnabled: z.boolean(),
      deviceIds: DataCatalogDeviceIds,
      devices: z.array(PreviewDeviceSchema).max(64)
    })
    .strict(),
  z.object({ state: z.literal('mobile'), enabled: z.boolean() }).strict(),
  z.object({ state: z.enum(['denied', 'unavailable']) }).strict()
])
export type DataCatalogPreviewPolicyResult = z.infer<typeof DataCatalogPreviewPolicyResultSchema>

export const DataCatalogSetPreviewAccessRequestSchema = z
  .object({
    rootId: DataCatalogRootId,
    desktopPreviewEnabled: z.boolean(),
    deviceIds: DataCatalogDeviceIds
  })
  .strict()
  .refine(({ deviceIds }) => new Set(deviceIds).size === deviceIds.length, {
    message: 'Preview device IDs must be unique',
    path: ['deviceIds']
  })
export type DataCatalogSetPreviewAccessRequest = z.infer<
  typeof DataCatalogSetPreviewAccessRequestSchema
>

const PreviewFailureState = z.enum([
  'denied',
  'unavailable',
  'expired',
  'changed',
  'unsupported',
  'unsupported_type',
  'too_large',
  'busy',
  'cancelled',
  'incomplete',
  'invalid_offset'
])

export const DataCatalogPreviewResolveRequestSchema = z
  .object({
    rootId: DataCatalogRootId,
    generation: Uuid,
    entryId: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()
export type DataCatalogPreviewResolveRequest = z.infer<
  typeof DataCatalogPreviewResolveRequestSchema
>

export const DataCatalogPreviewResolveResultSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('ready'),
      entryRef: EntryReference,
      rootId: DataCatalogRootId,
      generation: Uuid,
      fileVersion: FileVersion,
      sizeBytes: DecimalBytes,
      expiresInMs: z.literal(30_000)
    })
    .strict(),
  z.object({ state: PreviewFailureState }).strict()
])
export type DataCatalogPreviewResolveResult = z.infer<typeof DataCatalogPreviewResolveResultSchema>

export const DataCatalogPreviewStartRequestSchema = z.object({ entryRef: EntryReference }).strict()
export type DataCatalogPreviewStartRequest = z.infer<typeof DataCatalogPreviewStartRequestSchema>

export const DataCatalogPreviewStartResultSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('ready'),
      previewSessionId: PreviewSessionId,
      rootId: DataCatalogRootId,
      generation: Uuid,
      fileVersion: FileVersion,
      totalBytes: DecimalBytes,
      chunkBytes: z.literal(16_384),
      expiresInMs: z.literal(60_000)
    })
    .strict(),
  z.object({ state: PreviewFailureState }).strict()
])
export type DataCatalogPreviewStartResult = z.infer<typeof DataCatalogPreviewStartResultSchema>

export const DataCatalogPreviewChunkRequestSchema = z
  .object({ previewSessionId: PreviewSessionId, offset: z.number().int().min(0).max(262_144) })
  .strict()
export type DataCatalogPreviewChunkRequest = z.infer<typeof DataCatalogPreviewChunkRequestSchema>

export const DataCatalogPreviewChunkResultSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('chunk'),
      previewSessionId: PreviewSessionId,
      rootId: DataCatalogRootId,
      generation: Uuid,
      fileVersion: FileVersion,
      totalBytes: DecimalBytes,
      offset: z.number().int().min(0).max(262_144),
      nextOffset: z.number().int().min(0).max(262_144),
      final: z.boolean(),
      dataBase64: z
        .string()
        .max(21_848)
        .refine(
          (value) =>
            value.length % 4 === 0 &&
            /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
        )
    })
    .strict(),
  z.object({ state: PreviewFailureState }).strict()
])
export type DataCatalogPreviewChunkResult = z.infer<typeof DataCatalogPreviewChunkResultSchema>

const PreviewCompletionRequestSchema = z
  .object({ previewSessionId: PreviewSessionId, fileVersion: FileVersion })
  .strict()
export const DataCatalogPreviewFinishRequestSchema = PreviewCompletionRequestSchema
export const DataCatalogPreviewRenewRequestSchema = PreviewCompletionRequestSchema
export type DataCatalogPreviewFinishRequest = z.infer<typeof DataCatalogPreviewFinishRequestSchema>
export type DataCatalogPreviewRenewRequest = z.infer<typeof DataCatalogPreviewRenewRequestSchema>

const VisibleLease = z
  .object({ state: z.literal('visible'), leaseTtlMs: z.number().int().min(1).max(30_000) })
  .strict()
export const DataCatalogPreviewFinishResultSchema = z.discriminatedUnion('state', [
  VisibleLease,
  z.object({ state: PreviewFailureState }).strict()
])
export const DataCatalogPreviewRenewResultSchema = z.discriminatedUnion('state', [
  VisibleLease,
  z.object({ state: PreviewFailureState }).strict()
])
export type DataCatalogPreviewFinishResult = z.infer<typeof DataCatalogPreviewFinishResultSchema>
export type DataCatalogPreviewRenewResult = z.infer<typeof DataCatalogPreviewRenewResultSchema>

export const DataCatalogPreviewCloseRequestSchema = z
  .object({ previewSessionId: PreviewSessionId })
  .strict()
export type DataCatalogPreviewCloseRequest = z.infer<typeof DataCatalogPreviewCloseRequestSchema>
export const DataCatalogPreviewCloseResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('closed') }).strict(),
  z.object({ state: z.literal('denied') }).strict()
])
export type DataCatalogPreviewCloseResult = z.infer<typeof DataCatalogPreviewCloseResultSchema>

export const DataCatalogPreviewInvalidatedEventSchema = z
  .object({
    rootId: DataCatalogRootId,
    generation: Uuid,
    reason: z.enum(['revoked', 'root_changed', 'connection_ended', 'expired'])
  })
  .strict()
export type DataCatalogPreviewInvalidatedEvent = z.infer<
  typeof DataCatalogPreviewInvalidatedEventSchema
>
