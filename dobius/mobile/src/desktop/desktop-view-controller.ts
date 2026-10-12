import type { RpcClient } from '../transport/rpc-client'
import { desktopScreenReady } from '../transport/desktop-screen-stream-routing'
import {
  DESKTOP_SCREEN_CAPABILITY,
  type DesktopScreenFrame,
  type DesktopScreenSession
} from '../../../src/shared/desktop-screen-protocol'

export type DesktopBadge = 'Live' | 'Paused' | 'Reconnecting' | 'Stopped'
export function desktopScreenErrorMessage(code: string): string {
  switch (code) {
    case 'forbidden':
      return 'On your Mac, close Dobius+ and grant screen.view to your exact phone device ID using scripts/grant-mobile-permission.sh. Reopen Dobius+ and try again.'
    case 'screen_permission_missing':
      return 'On your Mac, open Settings → Mobile → Enable screen sharing. Allow Screen Recording for Dobius+ Computer Use. If macOS requires a restart, quit and reopen Dobius+ yourself.'
    case 'screen_not_authorized':
      return 'Tap View my screen again, then approve your named phone on the Mac.'
    case 'screen_busy':
      return 'Another phone is requesting or viewing this Mac. Use Stop on the Mac first.'
    case 'screen_unsupported':
      return 'This host cannot share a desktop screen. Use the updated graphical Dobius+ app on your Mac.'
    default:
      return 'Screen viewing ended. Check your Mac and tap View my screen to request a new session.'
  }
}
export function supportsDesktopScreen(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as { capabilities?: unknown }).capabilities) &&
    (value as { capabilities: unknown[] }).capabilities.includes(DESKTOP_SCREEN_CAPABILITY)
  )
}
type Callbacks = {
  visible(): boolean
  clear(): void
  frame(frame: DesktopScreenFrame): void
  badge(badge: DesktopBadge): void
  message(message: string | null): void
}

// No image buffers are retained here. Every async continuation is fenced by the current foreground epoch.
export class DesktopViewController {
  private epoch = 0
  private unsubscribe?: () => void
  private lease?: ReturnType<typeof setInterval>
  private session?: DesktopScreenSession
  private startedAt = 0
  private loaded = 0
  private currentSequence = 0
  private lastLoaded = 0
  private firstFrameMs?: number
  private lastLogAt = 0
  constructor(
    private readonly client: RpcClient,
    private readonly callbacks: Callbacks
  ) {}
  stop(badge: DesktopBadge = 'Stopped'): void {
    this.epoch++
    const unsubscribe = this.unsubscribe
    this.unsubscribe = undefined
    this.session = undefined
    this.currentSequence = 0
    clearInterval(this.lease)
    this.lease = undefined
    this.callbacks.clear()
    this.callbacks.badge(badge)
    this.callbacks.message(
      badge === 'Reconnecting'
        ? 'Can’t reach your Mac. Reconnect, then tap View my screen.'
        : 'Viewing ended. Tap View my screen to request a new session and approve it on the Mac.'
    )
    unsubscribe?.()
  }
  async start(): Promise<void> {
    this.stop('Paused')
    this.callbacks.message(null)
    if (!this.callbacks.visible() || this.client.getState() !== 'connected') {
      this.callbacks.message('Can’t reach your Mac. Connect, then tap View my screen.')
      return
    }
    const epoch = this.epoch
    const valid = (): boolean =>
      epoch === this.epoch && this.callbacks.visible() && this.client.getState() === 'connected'
    this.startedAt = Date.now()
    this.loaded = 0
    this.lastLoaded = 0
    this.firstFrameMs = undefined
    this.lastLogAt = 0
    try {
      const status = await this.client.sendRequest('status.get')
      if (!valid()) {
        return
      }
      if (!status.ok || !supportsDesktopScreen(status.result)) {
        this.callbacks.message(
          'Update desktop Dobius+ to a version with Desktop screen viewing, then try again.'
        )
        return
      }
      const capabilities = await this.client.sendRequest('screen.capabilities', {})
      if (!valid()) {
        return
      }
      if (!capabilities.ok) {
        this.callbacks.message(desktopScreenErrorMessage(capabilities.error.code))
        return
      }
      const result = capabilities.result as { supported?: boolean; permission?: string } | null
      if (!result?.supported || result.permission !== 'granted') {
        this.callbacks.message(
          desktopScreenErrorMessage(
            result?.supported ? 'screen_permission_missing' : 'screen_unsupported'
          )
        )
        return
      }
      this.callbacks.message('Approve your named phone on the Mac. Viewing starts after approval.')
      this.unsubscribe = this.client.subscribe(
        'screen.stream',
        { fps: 10, width: 1280 },
        (event) => {
          if (!valid()) {
            return
          }
          const ready = desktopScreenReady(event)
          if (ready) {
            this.session = ready
            // Measure capture startup from ready; human approval time is not frame latency.
            this.startedAt = Date.now()
            this.callbacks.message('Waiting for the first screen image…')
            this.renew(epoch)
            this.lease = setInterval(() => this.renew(epoch), 10000)
          } else if (event && typeof event === 'object') {
            const item = event as { type?: string; reason?: string; error?: { code?: string } }
            if (item.type === 'end' || item.type === 'error') {
              this.stop(item.reason === 'disconnected' ? 'Reconnecting' : 'Stopped')
              this.callbacks.message(
                item.reason === 'disconnected'
                  ? 'Can’t reach your Mac. Reconnect, then tap View my screen.'
                  : item.reason === 'congested'
                    ? 'The connection could not keep up. Tap View my screen to try again.'
                    : desktopScreenErrorMessage(item.error?.code ?? 'screen_not_authorized')
              )
            }
          }
        },
        {
          onDesktopFrame: (frame) => {
            if (
              !valid() ||
              !this.session ||
              frame.subscriptionId !== this.session.subscriptionId ||
              frame.generation !== this.session.generation
            ) {
              return
            }
            this.currentSequence = frame.sequence
            this.callbacks.frame(frame)
          }
        }
      )
    } catch {
      if (valid()) {
        this.stop('Stopped')
        this.callbacks.message('Can’t reach your Mac. Connect, then tap View my screen.')
      }
    }
  }
  private renew(epoch: number): void {
    if (epoch !== this.epoch || !this.callbacks.visible() || !this.session) {
      return
    }
    const ref = { subscriptionId: this.session.subscriptionId, generation: this.session.generation }
    void this.client
      .sendRequest('screen.lease.renew', ref)
      .then((response) => {
        if (epoch !== this.epoch) {
          return
        }
        if (!response.ok) {
          this.stop()
          this.callbacks.message(desktopScreenErrorMessage(response.error.code))
        }
      })
      .catch(() => {
        if (epoch === this.epoch) {
          this.stop('Reconnecting')
        }
      })
  }
  imageLoaded(sequence: number): void {
    if (
      !this.session ||
      !this.callbacks.visible() ||
      sequence !== this.currentSequence ||
      sequence <= this.lastLoaded
    ) {
      return
    }
    this.lastLoaded = sequence
    this.loaded++
    this.callbacks.badge('Live')
    this.callbacks.message(null)
    const elapsedMs = Date.now() - this.startedAt
    this.firstFrameMs ??= elapsedMs
    if (this.loaded === 1 || elapsedMs - this.lastLogAt >= 10000) {
      this.lastLogAt = elapsedMs
      // Only bounded counters/times enter Metro; never an image, URI, RPC event or error object.
      console.log('[desktop-screen] rendered', {
        loadedFrames: this.loaded,
        elapsedMs,
        renderedFps: (this.loaded * 1000) / Math.max(1, elapsedMs),
        firstFrameMs: this.firstFrameMs
      })
    }
  }
}
