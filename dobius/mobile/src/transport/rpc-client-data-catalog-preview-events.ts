import {
  DataCatalogPreviewInvalidatedEventSchema,
  type DataCatalogPreviewInvalidatedEvent
} from '../../../src/shared/data-catalog-preview-schema'

export function createDataCatalogPreviewEventRouter() {
  const listeners = new Set<(event: DataCatalogPreviewInvalidatedEvent) => void>()
  return {
    handle(raw: unknown, onAccepted?: () => void): boolean {
      const parsed = DataCatalogPreviewInvalidatedEventSchema.safeParse(raw)
      if (!parsed.success) {
        return false
      }
      onAccepted?.()
      for (const listener of listeners) {
        listener(parsed.data)
      }
      return true
    },
    subscribe(listener: (event: DataCatalogPreviewInvalidatedEvent) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    clear(): void {
      listeners.clear()
    }
  }
}
