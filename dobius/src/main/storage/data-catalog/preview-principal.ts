export type LocalWebContentsPreviewPrincipal = {
  kind: 'local-webcontents'
  principalId: 'desktop'
  connectionId: string
  hostId: string
  webContentsId: number
  navigationId: string
  signal: AbortSignal
}

export type PairedMobilePreviewPrincipal = {
  kind: 'paired-mobile'
  principalId: `device:${string}`
  deviceId: string
  connectionId: string
  hostId: string
  scope: 'mobile'
  signal: AbortSignal
}

/** Constructed by trusted main-process transport adapters, never from RPC parameters. */
export type CatalogPreviewPrincipal =
  | LocalWebContentsPreviewPrincipal
  | PairedMobilePreviewPrincipal

export type CatalogPreviewAuthorityTicket = {
  epoch: number
  principalKey: string
  connectionId: string
}

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export function catalogPreviewPrincipalKey(principal: CatalogPreviewPrincipal): string {
  return principal.kind === 'local-webcontents'
    ? `local\0${principal.hostId}\0${principal.webContentsId}\0${principal.navigationId}\0${principal.connectionId}`
    : `mobile\0${principal.hostId}\0${principal.deviceId}\0${principal.connectionId}`
}

export function isLivePreviewPrincipal(principal: CatalogPreviewPrincipal): boolean {
  if (
    principal.signal.aborted ||
    !OPAQUE_ID.test(principal.connectionId) ||
    !OPAQUE_ID.test(principal.hostId)
  ) {
    return false
  }
  if (principal.kind === 'local-webcontents') {
    return (
      principal.principalId === 'desktop' &&
      Number.isSafeInteger(principal.webContentsId) &&
      principal.webContentsId >= 0 &&
      OPAQUE_ID.test(principal.navigationId)
    )
  }
  return (
    principal.scope === 'mobile' &&
    principal.principalId === `device:${principal.deviceId}` &&
    DEVICE_ID.test(principal.deviceId)
  )
}
