import { randomUUID } from 'node:crypto'
import { registerCatalogPreviewInvalidationConnection } from '../runtime/rpc/data-catalog-preview-invalidation'
import type { DataCatalogPreviewInvalidatedEvent } from '../../shared/data-catalog-preview-schema'

export type LocalCatalogPreviewConnection = {
  readonly kind: 'local-webcontents'
  readonly connectionId: string
  readonly webContentsId: number
  readonly navigationId: number
  readonly signal: AbortSignal
}

type PreviewWebContents = {
  readonly id: number
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
  on(event: 'did-start-navigation', listener: NavigationListener): void
  off(event: 'did-start-navigation', listener: NavigationListener): void
  on(event: 'render-process-gone' | 'destroyed', listener: () => void): void
  off(event: 'render-process-gone' | 'destroyed', listener: () => void): void
}

type NavigationListener = (
  event: unknown,
  navigationUrl: string,
  isInPlace: boolean,
  isMainFrame: boolean
) => void

type DocumentState = {
  navigationId: number
  connectionId: string
  controller: AbortController
  disposed: boolean
  navigationListener: NavigationListener
  processGoneListener: () => void
  destroyedListener: () => void
  registeredConnectionId: string | null
}

const documentStates = new WeakMap<PreviewWebContents, DocumentState>()

function disposeDocument(contents: PreviewWebContents, state: DocumentState): void {
  if (state.disposed) {
    return
  }
  state.disposed = true
  state.controller.abort()
  contents.off('did-start-navigation', state.navigationListener)
  contents.off('render-process-gone', state.processGoneListener)
  contents.off('destroyed', state.destroyedListener)
  documentStates.delete(contents)
}

function createDocumentState(contents: PreviewWebContents): DocumentState {
  const state: DocumentState = {
    navigationId: 0,
    connectionId: `local:${contents.id}:${randomUUID()}`,
    controller: new AbortController(),
    disposed: false,
    navigationListener: () => undefined,
    processGoneListener: () => undefined,
    destroyedListener: () => undefined,
    registeredConnectionId: null
  }
  state.navigationListener = (_event, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace || state.disposed) {
      return
    }
    // Why: abort the prior document before issuing a fresh identity so a
    // delayed preview response cannot survive a top-frame navigation.
    state.controller.abort()
    state.navigationId += 1
    state.connectionId = `local:${contents.id}:${randomUUID()}`
    state.controller = new AbortController()
    state.registeredConnectionId = null
  }
  state.processGoneListener = () => disposeDocument(contents, state)
  state.destroyedListener = () => disposeDocument(contents, state)
  contents.on('did-start-navigation', state.navigationListener)
  contents.on('render-process-gone', state.processGoneListener)
  contents.on('destroyed', state.destroyedListener)
  documentStates.set(contents, state)
  return state
}

function registerInvalidationDelivery(contents: PreviewWebContents, state: DocumentState): void {
  if (state.registeredConnectionId === state.connectionId || state.controller.signal.aborted) {
    return
  }
  const connectionId = state.connectionId
  const signal = state.controller.signal
  const unregister = registerCatalogPreviewInvalidationConnection(connectionId, {
    signal,
    isCurrent: () =>
      !contents.isDestroyed() &&
      documentStates.get(contents) === state &&
      state.connectionId === connectionId &&
      state.controller.signal === signal &&
      !signal.aborted,
    send: (event: DataCatalogPreviewInvalidatedEvent) =>
      contents.send('dataCatalog:previewInvalidated', event)
  })
  if (unregister) {
    state.registeredConnectionId = connectionId
  }
}

export function localCatalogPreviewConnection(
  contents: PreviewWebContents
): LocalCatalogPreviewConnection | null {
  if (contents.isDestroyed()) {
    const existing = documentStates.get(contents)
    if (existing) {
      disposeDocument(contents, existing)
    }
    return null
  }
  let state = documentStates.get(contents)
  if (!state || state.disposed) {
    state = createDocumentState(contents)
  }
  registerInvalidationDelivery(contents, state)
  return {
    kind: 'local-webcontents',
    connectionId: state.connectionId,
    webContentsId: contents.id,
    navigationId: state.navigationId,
    signal: state.controller.signal
  }
}

export { emitCatalogPreviewInvalidated } from '../runtime/rpc/data-catalog-preview-invalidation'
