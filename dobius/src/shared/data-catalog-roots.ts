import { z } from 'zod'

export const DataCatalogRootKind = z.enum([
  'repository',
  'folder-workspace',
  'obsidian-vault',
  'artifact'
])
export const DataCatalogRootId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
export const DataCatalogDeviceIds = z.array(z.string().uuid()).max(64)
export const DataCatalogRootView = z
  .object({
    rootId: DataCatalogRootId,
    kind: DataCatalogRootKind,
    label: z.string().min(1).max(128),
    generation: z.string().uuid(),
    allowedDeviceIds: DataCatalogDeviceIds.optional()
  })
  .strict()
export type DataCatalogRootView = z.infer<typeof DataCatalogRootView>
export const DataCatalogRootsResult = z
  .object({
    state: z.enum(['ready', 'unavailable', 'denied']),
    roots: z.array(DataCatalogRootView).max(100)
  })
  .strict()
export type DataCatalogRootsResult = z.infer<typeof DataCatalogRootsResult>

export const DATA_CATALOG_DESKTOP_PRINCIPAL = 'desktop'
