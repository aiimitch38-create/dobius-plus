// Communications command: show_native_notification
//
// Real Electron API: `new Notification({title, body})` in the main process,
// which Chromium/Electron backs with genuine OS notifications on every
// platform (Notification Center on macOS, Action Center on Windows, a
// D-Bus/libnotify notification on Linux) — no custom native binding needed.
//
// Note for the build report: the vendor call site
// (features/notifications/lib/desktop.ts) only reaches this command when
// `isTauri() && isLinuxPlatform()`; `isTauri()` is always false in this
// Electron-hosted panel, so this path is currently unreachable from the
// renderer. It is still implemented for real (not a stub) because the
// feature it is meant to guarantee — a real OS notification appears — is
// already satisfied today by that same call site's non-Tauri fallback
// (`new window.Notification(...)`, which Electron's renderer also backs with
// real OS notifications). See RISKS.

export type NativeNotificationHandle = {
  show: () => void
  on: (event: 'click', listener: () => void) => void
}

export type NativeNotificationDeps = {
  isSupported: () => boolean
  createNotification: (opts: { title: string; body: string }) => NativeNotificationHandle
  onClicked?: (target: unknown) => void
}

export type ShowNativeNotificationParams = {
  title: string
  body: string
  target?: unknown
}

export type ShowNativeNotificationResult = { shown: boolean }

export function showNativeNotification(
  params: ShowNativeNotificationParams,
  deps: NativeNotificationDeps
): ShowNativeNotificationResult {
  if (!deps.isSupported()) {
    return { shown: false }
  }

  const notification = deps.createNotification({ title: params.title, body: params.body })
  if (params.target !== undefined && params.target !== null && deps.onClicked) {
    const onClicked = deps.onClicked
    notification.on('click', () => onClicked(params.target))
  }
  notification.show()
  return { shown: true }
}
