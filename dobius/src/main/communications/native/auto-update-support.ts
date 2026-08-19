// Communications command: is_auto_update_supported (disposition: dobius-rpc)
//
// The vendor client's own doc comment states the contract exactly: "Returns
// true on macOS, Windows, and Linux AppImage installs. Returns false on
// Linux non-AppImage packages (e.g. .deb) where Tauri's updater cannot swap
// the binary." Dobius's own electron-updater has the identical constraint —
// it can self-replace a macOS .app or a Windows installer, and a Linux
// AppImage (which is just a file it can overwrite + re-exec), but it cannot
// silently swap a .deb package outside a package manager. Dobius already
// builds both an AppImage and a .deb target for Linux (see
// config/electron-builder.config.cjs `linux.target`), so this distinction is
// real on this app, not just inherited boilerplate.
//
// AppImage detection mirrors the same env-var check this codebase already
// uses elsewhere (see src/main/startup/appimage-cli-redirect.ts): the
// AppImage runtime sets APPIMAGE (and usually APPDIR) in the process env.

export type AutoUpdateSupportDeps = {
  platform: NodeJS.Platform
  isRunningFromAppImage: () => boolean
}

export function isAutoUpdateSupported(deps: AutoUpdateSupportDeps): boolean {
  if (deps.platform === 'darwin' || deps.platform === 'win32') {
    return true
  }
  if (deps.platform === 'linux') {
    return deps.isRunningFromAppImage()
  }
  return false
}

export function isRunningFromAppImage(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.APPIMAGE || env.APPDIR)
}
