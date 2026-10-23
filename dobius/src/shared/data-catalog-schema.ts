import { z } from 'zod'
import { DataCatalogRootId } from './data-catalog-roots'

export const CatalogEntrySchema = z
  .object({
    entryId: z.string().regex(/^[a-f0-9]{64}$/),
    rootId: DataCatalogRootId,
    relativePath: z.string().min(1).max(1024),
    name: z.string().min(1).max(255),
    kind: z.enum(['file', 'directory']),
    sizeBytes: z.number().int().nonnegative().safe().nullable(),
    modifiedAtMs: z.number().finite().nonnegative().nullable(),
    contentDigestSha256: z.null(),
    backupCoverage: z.literal('unknown'),
    availability: z.literal('available'),
    observedAtMs: z.number().finite().nonnegative()
  })
  .strict()
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>

export const CatalogResultReason = z.enum([
  'access_denied',
  'root_unavailable',
  'root_changed',
  'cancelled',
  'expired',
  'invalid_cursor',
  'ambiguous_path',
  'scan_limit',
  'response_limit',
  'race_safety_unavailable',
  'filesystem_error'
])

export const CatalogResultSchema = z
  .object({
    state: z.enum(['complete', 'partial', 'denied', 'unavailable']),
    rootId: DataCatalogRootId.nullable(),
    entries: z.array(CatalogEntrySchema).max(200),
    cursor: z.string().min(32).max(128).nullable(),
    scannedEntries: z.number().int().nonnegative().safe(),
    reason: CatalogResultReason.nullable()
  })
  .strict()
export type CatalogResult = z.infer<typeof CatalogResultSchema>
