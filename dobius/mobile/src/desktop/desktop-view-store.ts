import { Buffer } from 'buffer'
import { useSyncExternalStore } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { DesktopViewController, type DesktopBadge } from './desktop-view-controller'
import type { DesktopScreenFrame } from '../../../src/shared/desktop-screen-protocol'

export type DesktopImageState = {
  uri: string
  width: number
  height: number
  sequence: number
}

export type DesktopViewSnapshot = {
  hostId: string | null
  widgetVisible: boolean
  image: DesktopImageState | null
  badge: DesktopBadge
  message: string | null
}

const initialSnapshot: DesktopViewSnapshot = {
  hostId: null,
  widgetVisible: false,
  image: null,
  badge: 'Paused',
  message: null
}

// One store owns one controller for the whole phone app. The full-page screen
// and floating widget only change which surface is visible; neither creates a
// second screen subscription.
export class DesktopViewStore {
  private snapshot: DesktopViewSnapshot = initialSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly clearers = new Set<() => void>()
  private hostId: string | null = null
  private client: RpcClient | null = null
  private controller: DesktopViewController | null = null
  private pageVisible = false
  private appActive = true
  private disconnect?: () => void

  routeChanged(hostId: string): void {
    if (this.hostId && hostId !== this.hostId) {
      this.dismissWidget()
    }
  }

  readonly getSnapshot = (): DesktopViewSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly onClear = (clear: () => void): (() => void) => {
    this.clearers.add(clear)
    return () => {
      this.clearers.delete(clear)
    }
  }

  private publish(patch: Partial<DesktopViewSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) {
      listener()
    }
  }

  private isVisible(): boolean {
    return this.appActive && (this.pageVisible || this.snapshot.widgetVisible)
  }

  enterPage(hostId: string, client: RpcClient): void {
    if (this.hostId !== hostId || this.client !== client) {
      this.controller?.stop('Paused')
      this.disconnect?.()
      this.pageVisible = false
      this.hostId = hostId
      this.client = client
      this.controller = null
      this.publish({
        hostId,
        widgetVisible: false,
        image: null,
        badge: 'Paused',
        message: null
      })
      this.controller = new DesktopViewController(client, {
        visible: () => this.hostId === hostId && this.client === client && this.isVisible(),
        clear: () => this.clearImage(),
        frame: (frame) => this.acceptFrame(frame),
        badge: (badge) => this.publish({ badge }),
        message: (message) => this.publish({ message })
      })
      this.disconnect = client.onStateChange((state) => this.setConnectionState(hostId, state))
    }
    this.pageVisible = true
    this.publish({ widgetVisible: false })
  }

  leavePage(hostId: string): void {
    if (this.hostId !== hostId) {
      return
    }
    this.pageVisible = false
    if (!this.snapshot.widgetVisible) {
      this.controller?.stop('Paused')
    }
  }

  setConnectionState(hostId: string, state: string): void {
    if (hostId === this.hostId && state !== 'connected') {
      this.controller?.stop('Reconnecting')
    }
  }

  setAppActive(active: boolean): void {
    if (this.appActive === active) {
      return
    }
    this.appActive = active
    if (!active) {
      this.controller?.stop('Paused')
    }
  }

  start(): Promise<void> {
    return this.controller?.start() ?? Promise.resolve()
  }

  stop(): void {
    this.controller?.stop('Stopped')
  }

  imageLoaded(image: DesktopImageState): void {
    if (image !== this.snapshot.image) {
      return
    }
    this.controller?.imageLoaded(image.sequence)
  }

  showWidget(): void {
    if (!this.hostId || !this.controller) {
      return
    }
    this.publish({ widgetVisible: true })
  }

  // Called when the widget itself navigates to the full Desktop page. Mark the
  // page as the visible owner before the route transition so its stream stays
  // alive while the widget disappears.
  handoffWidgetToPage(hostId: string): void {
    if (hostId !== this.hostId) {
      return
    }
    this.pageVisible = true
    this.publish({ widgetVisible: false })
  }

  dismissWidget(): void {
    this.publish({ widgetVisible: false })
    // Closing the widget is an explicit stop, even if the Desktop route is
    // still underneath it. It can only resume after an explicit View action.
    this.controller?.stop('Stopped')
  }

  private acceptFrame(frame: DesktopScreenFrame): void {
    this.publish({
      image: {
        uri: `data:image/jpeg;base64,${Buffer.from(frame.image).toString('base64')}`,
        width: frame.width,
        height: frame.height,
        sequence: frame.sequence
      }
    })
  }

  private clearImage(): void {
    for (const clear of this.clearers) {
      clear()
    }
    this.publish({ image: null })
  }
}

export const desktopViewStore = new DesktopViewStore()

export function useDesktopViewSnapshot(): DesktopViewSnapshot {
  return useSyncExternalStore(
    desktopViewStore.subscribe,
    desktopViewStore.getSnapshot,
    desktopViewStore.getSnapshot
  )
}
