import type { DesktopScreenFrame } from '../../../shared/desktop-screen-protocol'
import type {
  ScreenCapabilities,
  ScreenStreamParams,
  ScreenReference,
  ScreenOwner,
  ScreenEvent
} from './screen-contracts'

export type ScreenSession = ScreenReference & {
  owner: ScreenOwner
  emit: (event: ScreenEvent) => void
  expiry: number
  cancel: AbortController
  done: Promise<void>
  resolve: () => void
  timer?: ReturnType<typeof setInterval>
  producer?: ScreenProducer
  hide?: () => void
  removeAbort?: () => void
  ready: boolean
  sequence: number
  lastFrameAt: number
}

export type ScreenCaptureFrame = Pick<
  DesktopScreenFrame,
  'displayId' | 'width' | 'height' | 'image'
>
export type ScreenProducer = {
  start(frame: (frame: ScreenCaptureFrame) => void, failed: () => void): void
  stop(): void
}
export type ScreenCaptureBackend = {
  supported: boolean
  status(): Promise<ScreenCapabilities>
  create(params: ScreenStreamParams): ScreenProducer
}
export type ScreenConsentUi = {
  indicatorVisible(): boolean
  approve(name: string, signal: AbortSignal): Promise<boolean>
  show(name: string, stop: () => void, signal: AbortSignal): (() => void) | Promise<() => void>
}
export function validScreenParams(params: ScreenStreamParams): boolean {
  return (
    Number.isInteger(params.fps) &&
    params.fps >= 1 &&
    params.fps <= 10 &&
    Number.isInteger(params.width) &&
    params.width >= 320 &&
    params.width <= 1280
  )
}
export function screenDimensions(
  requestedWidth: number,
  display: { width: number; height: number }
): {
  width: number
  height: number
} {
  const width = Math.max(
    1,
    Math.floor(Math.min(requestedWidth, display.width, (1280 * display.width) / display.height))
  )
  return { width, height: Math.max(1, Math.floor((width * display.height) / display.width)) }
}
