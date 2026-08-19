// Communications command: get_os_idle_seconds
//
// Real Electron API: powerMonitor.getSystemIdleTime() — supported on macOS,
// Windows, and Linux X11. Electron does not document a failure return; on
// platforms where the OS query genuinely has no answer (e.g. some Wayland
// compositors) the binding can throw, so a throw is mapped to `null` to match
// the Tauri contract (`number | null`) the vendor client already expects.

export type IdleTimeDeps = {
  getSystemIdleTime: () => number
}

export function getOsIdleSeconds(deps: IdleTimeDeps): number | null {
  try {
    const seconds = deps.getSystemIdleTime()
    return Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : null
  } catch {
    return null
  }
}
