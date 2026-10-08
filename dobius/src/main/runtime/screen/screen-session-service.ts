import { randomUUID } from 'node:crypto'
import { DesktopScreenError } from '../../../shared/desktop-screen-errors'
import {
  encodeDesktopScreenFrame,
  type DesktopScreenFrame
} from '../../../shared/desktop-screen-protocol'
import type {
  DesktopScreenEndpoint,
  ScreenCapabilities,
  ScreenEvent,
  ScreenOwner,
  ScreenReference,
  ScreenStreamParams
} from './screen-contracts'

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
type Session = ScreenReference & {
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
type Device = { name: string; scope: string; grants?: readonly string[] }

// This owner is independent of generic runtime subscriptions: cleanup always verifies both identities.
export class ScreenSessionService implements DesktopScreenEndpoint {
  private active?: Session
  private ui?: ScreenConsentUi
  readonly counters = { sessions: 0, frames: 0, stopped: 0, captureStarts: 0, captureStops: 0 }
  constructor(
    private readonly backend: ScreenCaptureBackend,
    private readonly device: (id: string) => Device | null,
    private readonly now: () => number = Date.now
  ) {}
  get supported(): boolean {
    return this.backend.supported
  }
  setConsentUi(ui: ScreenConsentUi): void {
    this.ui = ui
  }

  private granted(owner: ScreenOwner): Device {
    const device = this.device(owner.deviceId)
    if (!device || device.scope !== 'mobile' || !device.grants?.includes('screen.view')) {
      throw new DesktopScreenError('screen_not_authorized')
    }
    return device
  }
  async capabilities(owner: ScreenOwner): Promise<ScreenCapabilities> {
    this.granted(owner)
    return this.backend.status()
  }
  private live(session: Session): boolean {
    if (this.active !== session || session.cancel.signal.aborted) {
      return false
    }
    if (session.ready && !this.ui?.indicatorVisible()) {
      this.stop('stopped')
      return false
    }
    if (session.owner.signal?.aborted) {
      this.stop('disconnected')
      return false
    }
    if (this.now() >= session.expiry) {
      this.stop('expired')
      return false
    }
    try {
      this.granted(session.owner)
    } catch {
      this.stop('revoked')
      return false
    }
    return true
  }
  private requireLive(session: Session): void {
    if (!this.live(session)) {
      throw new DesktopScreenError('screen_not_authorized')
    }
  }
  private wait<T>(task: Promise<T>, session: Session): Promise<T> {
    return Promise.race([
      task,
      session.done.then(() => {
        throw new DesktopScreenError('screen_not_authorized')
      })
    ])
  }

  async stream(
    params: ScreenStreamParams,
    owner: ScreenOwner,
    emit: (event: ScreenEvent) => void
  ): Promise<void> {
    const device = this.granted(owner)
    if (!owner.sendBinary || owner.signal?.aborted || !this.ui) {
      throw new DesktopScreenError('screen_not_authorized')
    }
    if (this.active) {
      throw new DesktopScreenError('screen_busy')
    }
    if (
      !Number.isInteger(params.fps) ||
      params.fps < 1 ||
      params.fps > 10 ||
      !Number.isInteger(params.width) ||
      params.width < 320 ||
      params.width > 1280
    ) {
      throw new DesktopScreenError('screen_not_authorized')
    }
    let resolve!: () => void
    const session: Session = {
      subscriptionId: randomUUID(),
      generation: randomUUID(),
      owner,
      emit,
      expiry: this.now() + 30000,
      cancel: new AbortController(),
      done: new Promise<void>((done) => {
        resolve = done
      }),
      resolve: () => resolve(),
      ready: false,
      sequence: 0,
      lastFrameAt: -Infinity
    }
    // Reserve and register cancellation before any permission/consent await.
    this.active = session
    this.counters.sessions++
    const abort = (): void => {
      if (this.active === session) {
        this.stop('disconnected')
      }
    }
    owner.signal?.addEventListener('abort', abort, { once: true })
    session.removeAbort = () => owner.signal?.removeEventListener('abort', abort)
    session.timer = setInterval(() => this.live(session), 250)
    session.timer.unref?.()
    try {
      const status = await this.wait(this.backend.status(), session)
      this.requireLive(session)
      if (!status.supported || !status.display) {
        throw new DesktopScreenError('screen_unsupported')
      }
      if (status.permission !== 'granted') {
        throw new DesktopScreenError('screen_permission_missing')
      }
      if (!(await this.wait(this.ui.approve(device.name, session.cancel.signal), session))) {
        throw new DesktopScreenError('screen_not_authorized')
      }
      this.requireLive(session)
      const width = Math.max(
        1,
        Math.floor(
          Math.min(
            params.width,
            status.display.width,
            (1280 * status.display.width) / status.display.height
          )
        )
      )
      const height = Math.max(1, Math.floor((width * status.display.height) / status.display.width))
      session.hide = await this.wait(Promise.resolve(this.ui.show(device.name, () => {
        if (this.active === session) {
          this.stop('stopped')
        }
      }, session.cancel.signal)), session)
      this.requireLive(session)
      session.ready = true
      emit({
        type: 'ready',
        subscriptionId: session.subscriptionId,
        generation: session.generation,
        displayId: status.display.id,
        width,
        height
      })
      this.requireLive(session)
      session.producer = this.backend.create({ fps: params.fps, width })
      this.counters.captureStarts++
      session.producer.start(
        (frame) => {
          if (!this.live(session)) {
            return
          }
          if (
            frame.displayId !== status.display!.id ||
            frame.width !== width ||
            frame.height !== height
          ) {
            this.stop('capture_failed')
            return
          }
          const now = this.now()
          if (now - session.lastFrameAt < 1000 / params.fps - 5) {
            return
          }
          session.lastFrameAt = now
          try {
            const bytes = encodeDesktopScreenFrame({
              ...frame,
              subscriptionId: session.subscriptionId,
              generation: session.generation,
              sequence: ++session.sequence
            })
            this.requireLive(session)
            if (owner.sendBinary!(bytes) === false) {
              // Conservatively stop on congestion immediately rather than keep capturing into a full queue.
              this.stop('congested')
              return
            }
            this.counters.frames++
          } catch {
            if (this.active === session) {
              this.stop('capture_failed')
            }
          }
        },
        () => {
          if (this.active === session) {
            this.stop('capture_failed')
          }
        }
      )
      await session.done
    } catch (error) {
      if (this.active === session) {
        this.stop('capture_failed')
      }
      throw error instanceof DesktopScreenError
        ? error
        : new DesktopScreenError('screen_unsupported')
    } finally {
      if (this.active === session) {
        this.stop('disconnected')
      }
    }
  }
  private owned(ref: ScreenReference, owner: ScreenOwner): Session {
    const session = this.active
    if (
      !session ||
      session.subscriptionId !== ref.subscriptionId ||
      session.generation !== ref.generation ||
      session.owner.deviceId !== owner.deviceId ||
      session.owner.connectionId !== owner.connectionId
    ) {
      throw new DesktopScreenError('screen_not_authorized')
    }
    return session
  }
  unsubscribe(ref: ScreenReference, owner: ScreenOwner): { unsubscribed: true } {
    this.owned(ref, owner)
    this.stop('stopped')
    return { unsubscribed: true }
  }
  renew(ref: ScreenReference, owner: ScreenOwner): { renewed: true } {
    const session = this.owned(ref, owner)
    this.requireLive(session)
    session.expiry = this.now() + 30000
    return { renewed: true }
  }
  revokeDevice(deviceId: string): void {
    if (this.active?.owner.deviceId === deviceId) {
      this.stop('revoked')
    }
  }
  stop(reason: string): void {
    const session = this.active
    if (!session) {
      return
    }
    // Fence the generation before invoking callbacks or awaiting native teardown.
    this.active = undefined
    session.cancel.abort()
    clearInterval(session.timer)
    session.removeAbort?.()
    if (session.producer) {
      session.producer.stop()
      this.counters.captureStops++
    }
    session.hide?.()
    this.counters.stopped++
    if (session.ready) {
      try {
        session.emit({
          type: 'end',
          subscriptionId: session.subscriptionId,
          generation: session.generation,
          reason
        })
      } catch {
        /* Disconnected channel. */
      }
    }
    session.resolve()
  }
}
