import type {
  DataCatalogPreviewChunkResult,
  DataCatalogPreviewStartResult
} from './data-catalog-preview-schema'

export type DataCatalogPreviewRpc = (method: string, params?: unknown) => Promise<unknown>
export type DataCatalogPreviewViewState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'visible'; text: string; deadline: number }
  | { phase: 'failed'; reason: string }
export type DataCatalogPreviewScope = { rootId: string; generation: string } | null
export type DataCatalogPreviewClientOptions = {
  rpc: DataCatalogPreviewRpc
  isForeground: () => boolean
  monotonicNow?: () => number
}

export class PreviewClientFailure extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

export function previewFailure(reason: string): PreviewClientFailure {
  return new PreviewClientFailure(reason)
}

export function dataCatalogPreviewFailureMessage(reason: string): string {
  switch (reason) {
    case 'denied':
      return 'Preview access is not enabled for this folder.'
    case 'unsupported':
    case 'unsupported_type':
      return 'This entry cannot be previewed here.'
    case 'too_large':
      return 'This entry is larger than the preview limit.'
    case 'expired':
    case 'cancelled':
      return 'Preview expired. Select Preview again to reload.'
    case 'changed':
    case 'incomplete':
    case 'invalid_offset':
      return 'The entry changed while it was being previewed. Select Preview again to reload.'
    case 'busy':
      return 'Another preview is active. Try again shortly.'
    default:
      return 'Preview is unavailable. Try again later.'
  }
}

export function assertPreviewChunkBinding(
  chunk: Extract<DataCatalogPreviewChunkResult, { state: 'chunk' }>,
  started: Extract<DataCatalogPreviewStartResult, { state: 'ready' }>
): void {
  if (
    chunk.previewSessionId !== started.previewSessionId ||
    chunk.rootId !== started.rootId ||
    chunk.generation !== started.generation ||
    chunk.fileVersion !== started.fileVersion ||
    chunk.totalBytes !== started.totalBytes
  ) {
    throw previewFailure('changed')
  }
}
