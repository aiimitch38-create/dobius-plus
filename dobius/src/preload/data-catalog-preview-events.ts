import {
  DataCatalogPreviewInvalidatedEventSchema,
  type DataCatalogPreviewInvalidatedEvent
} from '../shared/data-catalog-preview-schema'

export type DataCatalogPreviewIpc = {
  on(channel: string, listener: (_event: unknown, payload: unknown) => void): unknown
  removeListener(channel: string, listener: (_event: unknown, payload: unknown) => void): unknown
}

export function subscribeDataCatalogPreviewInvalidated(
  ipc: DataCatalogPreviewIpc,
  callback: (event: DataCatalogPreviewInvalidatedEvent) => void
): () => void {
  const listener = (_event: unknown, payload: unknown) => {
    const parsed = DataCatalogPreviewInvalidatedEventSchema.safeParse(payload)
    if (parsed.success) {
      callback(parsed.data)
    }
  }
  ipc.on('dataCatalog:previewInvalidated', listener)
  return () => ipc.removeListener('dataCatalog:previewInvalidated', listener)
}
