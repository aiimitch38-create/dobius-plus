import {
  DataCatalogPreviewChunkResultSchema,
  DataCatalogPreviewFinishResultSchema,
  DataCatalogPreviewResolveResultSchema,
  DataCatalogPreviewStartRequestSchema,
  DataCatalogPreviewStartResultSchema,
  type DataCatalogPreviewResolveRequest
} from './data-catalog-preview-schema'
import { previewFailure } from './data-catalog-preview-client-errors'
import {
  appendPreviewChunk,
  createPreviewAssembly,
  decodeCompletePreviewAssembly,
  disposePreviewAssembly,
  PreviewAssemblyError,
  validateCompletePreviewAssembly,
  type PreviewAssembly
} from './data-catalog-preview-assembly'

const MAX_VISIBLE_LEASE_MS = 30_000

export type PreviewTransferResult = {
  sessionId: string
  fileVersion: string
  text: string
  visibleDeadline: number
  renewedAt: number
}

export async function runCatalogPreviewTransfer(options: {
  rpc: (method: string, params?: unknown) => Promise<unknown>
  request: DataCatalogPreviewResolveRequest
  now: () => number
  isCurrent: () => boolean
  registerSession: (sessionId: string, fileVersion: string) => boolean
  setAssembly: (assembly: PreviewAssembly | null) => void
}): Promise<PreviewTransferResult> {
  let assembly: PreviewAssembly | null = null
  try {
    const resolveRaw = await options.rpc('data.catalog.preview.resolve', options.request)
    assertCurrent(options.isCurrent)
    const resolved = DataCatalogPreviewResolveResultSchema.safeParse(resolveRaw)
    if (!resolved.success) {
      throw previewFailure('unavailable')
    }
    if (resolved.data.state !== 'ready') {
      throw previewFailure(resolved.data.state)
    }
    if (
      resolved.data.rootId !== options.request.rootId ||
      resolved.data.generation !== options.request.generation
    ) {
      throw previewFailure('changed')
    }

    const startRequest = DataCatalogPreviewStartRequestSchema.parse({
      entryRef: resolved.data.entryRef
    })
    const startRaw = await options.rpc('data.catalog.preview.start', startRequest)
    const started = DataCatalogPreviewStartResultSchema.safeParse(startRaw)
    if (!started.success) {
      throw previewFailure('unavailable')
    }
    if (started.data.state !== 'ready') {
      throw previewFailure(started.data.state)
    }
    if (
      started.data.rootId !== resolved.data.rootId ||
      started.data.generation !== resolved.data.generation ||
      started.data.fileVersion !== resolved.data.fileVersion ||
      started.data.totalBytes !== resolved.data.sizeBytes
    ) {
      throw previewFailure('changed')
    }
    if (!options.isCurrent()) {
      await closeRemoteSession(options.rpc, started.data.previewSessionId)
      throw previewFailure('cancelled')
    }
    if (!options.registerSession(started.data.previewSessionId, started.data.fileVersion)) {
      await closeRemoteSession(options.rpc, started.data.previewSessionId)
      throw previewFailure('cancelled')
    }

    assembly = createPreviewAssembly(
      started.data.previewSessionId,
      started.data.fileVersion,
      started.data.totalBytes
    )
    options.setAssembly(assembly)
    while (!assembly.complete) {
      assertCurrent(options.isCurrent)
      const chunkRaw = await options.rpc('data.catalog.preview.chunk', {
        previewSessionId: started.data.previewSessionId,
        offset: assembly.nextOffset
      })
      assertCurrent(options.isCurrent)
      const chunk = DataCatalogPreviewChunkResultSchema.safeParse(chunkRaw)
      if (!chunk.success) {
        throw previewFailure('unavailable')
      }
      if (chunk.data.state !== 'chunk') {
        throw previewFailure(chunk.data.state)
      }
      if (
        chunk.data.previewSessionId !== started.data.previewSessionId ||
        chunk.data.rootId !== started.data.rootId ||
        chunk.data.generation !== started.data.generation ||
        chunk.data.fileVersion !== started.data.fileVersion ||
        chunk.data.totalBytes !== started.data.totalBytes
      ) {
        throw previewFailure('changed')
      }
      appendPreviewChunk(assembly, chunk.data)
    }

    assertCurrent(options.isCurrent)
    try {
      validateCompletePreviewAssembly(assembly)
    } catch (error) {
      if (
        error instanceof PreviewAssemblyError &&
        (error.reason === 'non_text' || error.reason === 'invalid_utf8')
      ) {
        throw previewFailure('unsupported_type')
      }
      throw error
    }
    assertCurrent(options.isCurrent)
    const finishStartedAt = options.now()
    const finishRaw = await options.rpc('data.catalog.preview.finish', {
      previewSessionId: started.data.previewSessionId,
      fileVersion: started.data.fileVersion
    })
    assertCurrent(options.isCurrent)
    const finished = DataCatalogPreviewFinishResultSchema.safeParse(finishRaw)
    if (!finished.success || finished.data.state !== 'visible') {
      throw previewFailure(finished.success ? finished.data.state : 'unavailable')
    }
    const visibleDeadline =
      finishStartedAt + Math.min(MAX_VISIBLE_LEASE_MS, finished.data.leaseTtlMs)
    if (
      options.now() >= finishStartedAt + MAX_VISIBLE_LEASE_MS ||
      visibleDeadline <= options.now()
    ) {
      throw previewFailure('expired')
    }
    assertCurrent(options.isCurrent)
    let text: string
    try {
      text = decodeCompletePreviewAssembly(assembly)
    } catch (error) {
      if (error instanceof PreviewAssemblyError && error.reason === 'non_text') {
        throw previewFailure('unsupported_type')
      }
      throw error
    }
    assembly = null
    options.setAssembly(null)
    if (options.now() >= visibleDeadline) {
      throw previewFailure('expired')
    }
    return {
      sessionId: started.data.previewSessionId,
      fileVersion: started.data.fileVersion,
      text,
      visibleDeadline,
      renewedAt: options.now()
    }
  } catch (error) {
    if (assembly) {
      disposePreviewAssembly(assembly)
    }
    options.setAssembly(null)
    throw error
  }
}

function assertCurrent(isCurrent: () => boolean): void {
  if (!isCurrent()) {
    throw previewFailure('cancelled')
  }
}

async function closeRemoteSession(
  rpc: (method: string, params?: unknown) => Promise<unknown>,
  previewSessionId: string
): Promise<void> {
  try {
    await rpc('data.catalog.preview.close', { previewSessionId })
  } catch {
    // Server-side session expiry is the fallback if a transport is already closed.
  }
}
