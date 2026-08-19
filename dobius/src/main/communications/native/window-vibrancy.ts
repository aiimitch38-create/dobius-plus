// Communications command: set_window_vibrancy
//
// Real Electron API: BrowserWindow#setVibrancy(material | null). Electron
// documents this as macOS-only; the vendor client already comments "On
// non-macOS set_window_vibrancy is a no-op and translucency stays off", so a
// no-op elsewhere matches the contract the client was written against.
//
// The RPC layer has no per-request window/sender identity today (the
// Communications bridge dispatches by method name only — see
// communications-gateway.ts), so this applies to every window returned by
// `getTargetWindows`. In the current single-project-window-per-app shape
// that is the one window hosting the embedded Buzz panel; see RISKS in the
// build report for the precise-targeting gap.

export type VibrancyWindowHandle = {
  isDestroyed: () => boolean
  setVibrancy: (material: string | null) => void
}

export type WindowVibrancyDeps = {
  platform: NodeJS.Platform
  getTargetWindows: () => VibrancyWindowHandle[]
}

export type SetWindowVibrancyParams = {
  enabled: boolean
  material: string
}

export type WindowVibrancyResult =
  | { applied: true; windowCount: number }
  | { applied: false; reason: 'unsupported_platform' | 'no_target_window' }

export function setWindowVibrancy(
  params: SetWindowVibrancyParams,
  deps: WindowVibrancyDeps
): WindowVibrancyResult {
  if (deps.platform !== 'darwin') {
    return { applied: false, reason: 'unsupported_platform' }
  }

  const windows = deps.getTargetWindows().filter((win) => !win.isDestroyed())
  if (windows.length === 0) {
    return { applied: false, reason: 'no_target_window' }
  }

  const material = params.enabled ? params.material : null
  for (const win of windows) {
    win.setVibrancy(material)
  }
  return { applied: true, windowCount: windows.length }
}
