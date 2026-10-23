import { z } from 'zod'
import { DataCatalogRootId, DataCatalogRootKind } from '../../../shared/data-catalog-roots'
import {
  CatalogEntrySchema,
  CatalogResultReason,
  CatalogResultSchema,
  type CatalogEntry,
  type CatalogResult
} from '../../../shared/data-catalog-schema'

export { CatalogEntrySchema, CatalogResultReason, CatalogResultSchema }
export type { CatalogEntry, CatalogResult }

export const CatalogOpaqueId = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !value.includes('/') && !value.includes('\\') && !value.includes('\0'))
export type CatalogOpaqueId = z.infer<typeof CatalogOpaqueId>

export const CatalogRootId = DataCatalogRootId
export type CatalogRootId = z.infer<typeof CatalogRootId>

export const CatalogRootKind = DataCatalogRootKind
export type CatalogRootKind = z.infer<typeof CatalogRootKind>

/** Opened-descriptor identities omit root incarnation because the live handle pins the inode. */
export type CatalogFileIdentity = { dev: string; ino: string; birthtimeNs?: string }

function isPositiveCanonicalTokenAtMost(
  value: string,
  maxLength: number,
  maximum: bigint
): boolean {
  if (value.length > maxLength || !/^[1-9][0-9]*$/.test(value)) {
    return false
  }
  return BigInt(value) <= maximum
}

const LinuxRootIncarnationSchema = z
  .object({
    provider: z.literal('linux-inode-generation-v1'),
    scope: z.string().regex(/^[0-9a-f]{16}$/),
    token: z.string().refine((value) => isPositiveCanonicalTokenAtMost(value, 10, 0xffff_ffffn))
  })
  .strict()

const DarwinRootIncarnationSchema = z
  .object({
    provider: z.literal('darwin-apfs-file-id-v1'),
    scope: z.string().regex(/^[0-9a-f]{32}$/),
    token: z
      .string()
      .refine((value) => isPositiveCanonicalTokenAtMost(value, 20, 0xffff_ffff_ffff_ffffn))
  })
  .strict()

export const CatalogRootIncarnationSchema = z.discriminatedUnion('provider', [
  LinuxRootIncarnationSchema,
  DarwinRootIncarnationSchema
])
export type CatalogRootIncarnation = z.infer<typeof CatalogRootIncarnationSchema>

export const CatalogRootIdentitySchema = z
  .object({
    dev: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .max(128),
    ino: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .max(128),
    birthtimeNs: z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .max(128)
      .optional(),
    incarnation: CatalogRootIncarnationSchema
  })
  .strict()
export type CatalogRootIdentity = z.infer<typeof CatalogRootIdentitySchema>

export type CatalogRootIdentityReader = (path: string) => Promise<CatalogRootIdentity>

/** Supplied only by the injected trusted authority; never accepted from a browse request. */
export type RegisteredCatalogRoot = {
  id: CatalogRootId
  kind: CatalogRootKind
  label: string
  canonicalPath: string
  identity: CatalogRootIdentity
  /** Changes whenever authorization or root registration is replaced. */
  generation: CatalogOpaqueId
  browseGranted: true
}

export const RegisteredCatalogRootSchema = z
  .object({
    id: CatalogRootId,
    kind: CatalogRootKind,
    label: z.string().min(1).max(128),
    canonicalPath: z.string().min(1).max(4096),
    identity: CatalogRootIdentitySchema,
    generation: CatalogOpaqueId,
    browseGranted: z.literal(true)
  })
  .strict()

/** The provider must apply the app's explicit browse permission for this principal/root pair. */
export type RegisteredCatalogRootProvider = {
  resolveAuthorizedRoot(
    principalId: CatalogOpaqueId,
    rootId: CatalogRootId,
    signal?: AbortSignal
  ): Promise<RegisteredCatalogRoot | null>
}

export const CatalogScanLimitsSchema = z
  .object({
    pageSize: z.number().int().positive().max(200).default(100),
    maxEntries: z.number().int().positive().max(20_000).default(5000),
    maxOperationsPerPage: z.number().int().positive().max(4000).default(800),
    maxDepth: z.number().int().positive().max(64).default(32),
    maxFrontier: z.number().int().positive().max(128).default(64),
    maxResponseBytes: z
      .number()
      .int()
      .min(1024)
      .max(2 * 1024 * 1024)
      .default(512 * 1024),
    maxElapsedMs: z.number().int().positive().max(5000).default(1000),
    sessionTtlMs: z.number().int().positive().max(90_000).default(30_000),
    maxSessions: z.number().int().positive().max(128).default(32)
  })
  .strict()
export type CatalogScanLimits = z.infer<typeof CatalogScanLimitsSchema>

export type CatalogRequest = {
  rootId: CatalogRootId
  cursor?: string | null
  pageSize?: number
  signal?: AbortSignal
}

export type CatalogClock = () => number
