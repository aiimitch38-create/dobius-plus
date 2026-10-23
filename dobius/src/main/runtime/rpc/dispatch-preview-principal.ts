import type { CatalogPreviewPrincipal } from '../../storage/data-catalog/preview-principal'
import type { LocalCatalogPreviewConnection } from '../../ipc/data-catalog-preview-lifecycle'
import type { DobiusRuntimeService } from '../dobius-runtime'

export function localWebContentsPreviewPrincipal(
  runtime: DobiusRuntimeService,
  connection: LocalCatalogPreviewConnection
): CatalogPreviewPrincipal {
  return {
    kind: 'local-webcontents',
    principalId: 'desktop',
    connectionId: connection.connectionId,
    hostId: runtime.getRuntimeId(),
    webContentsId: connection.webContentsId,
    navigationId: String(connection.navigationId),
    signal: connection.signal
  }
}

export function websocketPreviewPrincipal(
  runtime: DobiusRuntimeService,
  options: {
    connectionId?: string
    connectionSignal?: AbortSignal
    clientKind?: 'mobile' | 'runtime'
    clientDeviceId?: string
  }
): CatalogPreviewPrincipal | undefined {
  if (
    options.clientKind !== 'mobile' ||
    !options.connectionId ||
    !options.connectionSignal ||
    !options.clientDeviceId
  ) {
    return undefined
  }
  return {
    kind: 'paired-mobile',
    principalId: `device:${options.clientDeviceId}`,
    deviceId: options.clientDeviceId,
    connectionId: options.connectionId,
    hostId: runtime.getRuntimeId(),
    scope: 'mobile',
    signal: options.connectionSignal
  }
}
