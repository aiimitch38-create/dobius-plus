import type { BrowserScreencastFrame } from './browser-screencast-protocol'
import type { DesktopScreenFrame } from '../../../src/shared/desktop-screen-protocol'
export type SubscribeOptions = {
  onBinaryFrame?: (frame: BrowserScreencastFrame) => void
  onDesktopFrame?: (frame: DesktopScreenFrame) => void
}
export type StreamingListener = (result: unknown) => void
export type StreamRequest = {
  method: string
  params: unknown
  listener: StreamingListener
  onBinaryFrame?: (frame: BrowserScreencastFrame) => void
  subscriptionId?: string
  cancelled?: boolean
  sent?: boolean
  everSent?: boolean
}
export function isTerminalSubscribedResult(
  value: unknown
): value is { type: 'subscribed'; streamId: number } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'subscribed' &&
    typeof (value as { streamId?: unknown }).streamId === 'number'
  )
}
export function isBrowserScreencastReadyResult(
  value: unknown
): value is { type: 'ready'; subscriptionId: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'ready' &&
    typeof (value as { subscriptionId?: unknown }).subscriptionId === 'string'
  )
}
