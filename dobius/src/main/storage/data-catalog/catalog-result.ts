import { CatalogResultSchema, type CatalogResult } from '../../../shared/data-catalog-schema'

export function emptyCatalogResult(
  state: CatalogResult['state'],
  reason: CatalogResult['reason'],
  rootId: CatalogResult['rootId'] = null
): CatalogResult {
  return CatalogResultSchema.parse({
    state,
    rootId,
    entries: [],
    cursor: null,
    scannedEntries: 0,
    reason
  })
}
