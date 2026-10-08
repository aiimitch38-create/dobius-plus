import type { RpcContext } from '../rpc/core'
import type { DesktopScreenSession } from '../../../shared/desktop-screen-protocol'

export type ScreenStreamParams = { fps: number; width: number }
export type ScreenReference = Pick<DesktopScreenSession, 'subscriptionId' | 'generation'>
export type ScreenOwner = {
  deviceId: string
  connectionId: string
  signal?: AbortSignal
  sendBinary?: RpcContext['sendBinary']
}
export type ScreenCapabilities = {
  supported: boolean
  permission: 'granted' | 'missing'
  display?: { id: number; width: number; height: number }
  maxFps: number
  maxWidth: number
}
export type ScreenEvent =
  | (DesktopScreenSession & { type: 'ready'; width: number; height: number })
  | (ScreenReference & { type: 'end'; reason: string })

// Optional injection keeps Electron and native capture out of headless runtimes.
export type DesktopScreenEndpoint = {
  readonly supported: boolean
  capabilities(owner: ScreenOwner): Promise<ScreenCapabilities>
  stream(
    params: ScreenStreamParams,
    owner: ScreenOwner,
    emit: (event: ScreenEvent) => void
  ): Promise<void>
  unsubscribe(ref: ScreenReference, owner: ScreenOwner): { unsubscribed: true }
  renew(ref: ScreenReference, owner: ScreenOwner): { renewed: true }
  stop(reason: string): void
  revokeDevice(deviceId: string): void
}
