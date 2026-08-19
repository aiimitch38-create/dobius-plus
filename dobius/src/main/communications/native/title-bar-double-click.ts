// Communications command: title_bar_double_click
//
// Buzz draws its own web title-bar drag region, so the OS never sees a real
// title-bar double-click and can't act on its own `AppleActionOnDoubleClick`
// preference. Real implementation on macOS: read that preference via
// systemPreferences.getUserDefault (a genuine Electron API) and perform the
// matching window action ourselves.
//
// Windows/Linux have no equivalent "double-click title bar" system
// preference exposed to Electron, and Dobius does not draw a custom title
// bar on those platforms the way Buzz's embedded panel does — so this is a
// documented no-op there, not a fake success.

export type TitleBarDoubleClickAction = 'minimize' | 'zoom' | 'none'

// Why: pure mapping extracted so the macOS preference string -> action
// decision is testable without touching systemPreferences or a real window.
export function resolveTitleBarDoubleClickAction(
  preference: string | null
): TitleBarDoubleClickAction {
  switch (preference) {
    case 'Minimize':
      return 'minimize'
    // Why: macOS 13+ renamed the "zoom to fill" preference value from
    // "Maximize" to "Fill"; both map to the same native double-click gesture.
    case 'Maximize':
    case 'Fill':
      return 'zoom'
    default:
      return 'none'
  }
}

export type TitleBarWindowHandle = {
  isDestroyed: () => boolean
  isMaximized: () => boolean
  minimize: () => void
  maximize: () => void
  unmaximize: () => void
}

export type TitleBarDoubleClickDeps = {
  platform: NodeJS.Platform
  getDoubleClickPreference: () => string | null
  getTargetWindow: () => TitleBarWindowHandle | null
}

export type TitleBarDoubleClickResult =
  | { performed: true; action: TitleBarDoubleClickAction }
  | { performed: false; reason: 'unsupported_platform' | 'no_target_window' }

export function performTitleBarDoubleClickAction(
  deps: TitleBarDoubleClickDeps
): TitleBarDoubleClickResult {
  if (deps.platform !== 'darwin') {
    return { performed: false, reason: 'unsupported_platform' }
  }

  const action = resolveTitleBarDoubleClickAction(deps.getDoubleClickPreference())
  const win = deps.getTargetWindow()
  if (!win || win.isDestroyed()) {
    return { performed: false, reason: 'no_target_window' }
  }

  if (action === 'minimize') {
    win.minimize()
  } else if (action === 'zoom') {
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  }

  return { performed: true, action }
}
