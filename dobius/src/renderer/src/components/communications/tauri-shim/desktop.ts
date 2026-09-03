/**
 * Stand-ins for the smaller Tauri surfaces the restored tree touches: window,
 * webview, app, path, and the three plugins. Each maps to the Electron or DOM
 * equivalent where one exists, and degrades to a safe no-op where it does not,
 * so a shell affordance with no meaning inside a Dobius+ tab cannot throw
 * mid-render. Window chrome (drag, fullscreen, badges) belongs to the Dobius+
 * frame, not to this view, which is why those are deliberately inert.
 */

/** Tauri exports this as an enum, so it is used as a value as well as a type. */
export const UserAttentionType = {
  Critical: 1,
  Informational: 2
} as const
export type UserAttentionType = (typeof UserAttentionType)[keyof typeof UserAttentionType]

export type UnlistenFn = () => void

export type WindowHandle = {
  setFocus(): Promise<void>
  isFocused(): Promise<boolean>
  isVisible(): Promise<boolean>
  isFullscreen(): Promise<boolean>
  show(): Promise<void>
  hide(): Promise<void>
  unminimize(): Promise<void>
  setTitle(title: string): Promise<void>
  startDragging(): Promise<void>
  setBadgeCount(count?: number | null): Promise<void>
  setBadgeLabel(label?: string | null): Promise<void>
  requestUserAttention(kind?: UserAttentionType | null): Promise<void>
  onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<UnlistenFn>
  onResized(handler: (event: unknown) => void): Promise<UnlistenFn>
  onThemeChanged(handler: (event: { payload: string }) => void): Promise<UnlistenFn>
}

function domListener(target: EventTarget, events: string[], run: () => void): UnlistenFn {
  for (const event of events) {
    target.addEventListener(event, run)
  }
  return () => {
    for (const event of events) {
      target.removeEventListener(event, run)
    }
  }
}

export function getCurrentWindow(): WindowHandle {
  return {
    setFocus: async () => {
      window.focus()
    },
    isFocused: async () => document.hasFocus(),
    isVisible: async () => document.visibilityState === 'visible',
    isFullscreen: async () => Boolean(document.fullscreenElement),
    show: async () => {},
    hide: async () => {},
    unminimize: async () => {},
    setTitle: async (title: string) => {
      document.title = title
    },
    // Dragging, badges and attention belong to the Dobius+ window frame.
    startDragging: async () => {},
    setBadgeCount: async () => {},
    setBadgeLabel: async () => {},
    requestUserAttention: async () => {},
    onFocusChanged: async (handler) => {
      const onFocus = (): void => handler({ payload: true })
      const onBlur = (): void => handler({ payload: false })
      window.addEventListener('focus', onFocus)
      window.addEventListener('blur', onBlur)
      return () => {
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('blur', onBlur)
      }
    },
    onResized: async (handler) => domListener(window, ['resize'], () => handler({})),
    onThemeChanged: async (handler) => {
      const query = window.matchMedia('(prefers-color-scheme: dark)')
      const run = (): void => handler({ payload: query.matches ? 'dark' : 'light' })
      query.addEventListener('change', run)
      return () => query.removeEventListener('change', run)
    }
  }
}

/** Notification action routing has no equivalent here. Callers keep the handle
 *  and call unregister(), so the shape matters more than the behaviour. */
export async function onAction(
  _handler: (notification: { extra?: Record<string, unknown> }) => void
): Promise<{ unregister: () => Promise<void> }> {
  return { unregister: async () => {} }
}

export function getCurrentWebview(): {
  onDragDropEvent(handler: (event: unknown) => void): Promise<UnlistenFn>
  setZoom(factor: number): Promise<void>
} {
  return {
    onDragDropEvent: async () => () => {},
    // Zoom is a Dobius+ window concern, not this view's.
    setZoom: async () => {}
  }
}

export async function getVersion(): Promise<string> {
  return String(import.meta.env.VITE_APP_VERSION ?? '0.0.0')
}

export async function homeDir(): Promise<string> {
  return '~'
}

/** Opens externally so a link never navigates the app window away. */
export async function openUrl(url: string): Promise<void> {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function openPath(path: string): Promise<void> {
  await openUrl(`file://${path}`)
}

export async function relaunch(): Promise<void> {
  window.location.reload()
}

export async function exit(_code?: number): Promise<void> {}

export type Update = {
  version: string
  currentVersion: string
  date?: string
  body?: string
  close(): Promise<void>
  download(onEvent?: (event: unknown) => void): Promise<void>
  install(): Promise<void>
  downloadAndInstall(onEvent?: (event: unknown) => void): Promise<void>
}

/** Dobius+ owns updates; the Communications view never drives them, so there is
 *  never an update to report here. */
export async function check(_options?: unknown): Promise<Update | null> {
  return null
}

export async function isPermissionGranted(): Promise<boolean> {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}

export async function requestPermission(): Promise<'granted' | 'denied'> {
  if (typeof Notification === 'undefined') {
    return 'denied'
  }
  const result = await Notification.requestPermission()
  return result === 'granted' ? 'granted' : 'denied'
}

export function sendNotification(options: { title: string; body?: string } | string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return
  }
  const payload = typeof options === 'string' ? { title: options } : options
  new Notification(payload.title, payload.body ? { body: payload.body } : undefined)
}
