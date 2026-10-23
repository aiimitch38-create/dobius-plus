import {
  DataCatalogPreviewInvalidatedEventSchema,
  type DataCatalogPreviewInvalidatedEvent
} from '../../../shared/data-catalog-preview-schema'

export type CatalogPreviewInvalidationConnection = {
  signal: AbortSignal
  isCurrent(): boolean
  send(event: DataCatalogPreviewInvalidatedEvent): void
}
export type EncryptedCatalogPreviewInvalidationConnection = Omit<
  CatalogPreviewInvalidationConnection,
  'send'
> & { sendEncrypted(frame: string): void }

type Registration = CatalogPreviewInvalidationConnection & { onAbort: () => void }
const registrations = new Map<string, Registration>()
const MAX_CONNECTIONS = 256

export function registerCatalogPreviewInvalidationConnection(
  connectionId: string,
  connection: CatalogPreviewInvalidationConnection
): (() => void) | null {
  if (!connectionId || connectionId.length > 128 || connection.signal.aborted) {
    return null
  }
  if (registrations.has(connectionId) || registrations.size >= MAX_CONNECTIONS) {
    return null
  }
  const registration: Registration = { ...connection, onAbort: () => undefined }
  const unregister = () => {
    if (registrations.get(connectionId) !== registration) {
      return
    }
    registrations.delete(connectionId)
    registration.signal.removeEventListener('abort', registration.onAbort)
  }
  registration.onAbort = unregister
  registrations.set(connectionId, registration)
  registration.signal.addEventListener('abort', registration.onAbort, { once: true })
  return unregister
}

export function registerEncryptedCatalogPreviewInvalidationConnection(
  connectionId: string,
  connection: EncryptedCatalogPreviewInvalidationConnection
): (() => void) | null {
  return registerCatalogPreviewInvalidationConnection(connectionId, {
    signal: connection.signal,
    isCurrent: connection.isCurrent,
    send: (event) => connection.sendEncrypted(JSON.stringify(event))
  })
}

/** Cache only successful authenticated mobile registrations; failed attempts can retry later. */
export function ensureEncryptedCatalogPreviewInvalidationRegistration<K>(
  registrationsByOwner: Map<K, () => void>,
  owner: K,
  connectionId: string,
  scope: string | null,
  connection: EncryptedCatalogPreviewInvalidationConnection
): boolean {
  if (scope !== 'mobile') {
    registrationsByOwner.get(owner)?.()
    registrationsByOwner.delete(owner)
    return false
  }
  if (registrationsByOwner.has(owner)) {
    return true
  }
  const unregister = registerEncryptedCatalogPreviewInvalidationConnection(connectionId, connection)
  if (!unregister) {
    return false
  }
  registrationsByOwner.set(owner, unregister)
  return true
}

export function emitCatalogPreviewInvalidated(connectionId: string, rawEvent: unknown): boolean {
  const parsed = DataCatalogPreviewInvalidatedEventSchema.safeParse(rawEvent)
  const registration = registrations.get(connectionId)
  if (!parsed.success || !registration || registration.signal.aborted) {
    return false
  }
  try {
    if (!registration.isCurrent()) {
      registration.onAbort()
      return false
    }
    registration.send(parsed.data)
    return true
  } catch {
    registration.onAbort()
    return false
  }
}
