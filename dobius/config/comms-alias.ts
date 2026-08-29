import { resolve } from 'node:path'

const COMMS_ROOT = 'src/renderer/src/components/communications'
const COMMS_SHIM = `${COMMS_ROOT}/tauri-shim`

/**
 * Module aliases the restored Communications client needs.
 *
 * Shared by every config that bundles the renderer — `electron.vite.config.ts`
 * for the desktop app and `vite.web.config.ts` for the mobile web build. They
 * must stay identical: the two configs bundle the same `App.tsx`, so an alias
 * present in one and missing from the other fails only in the build that lacks
 * it, long after the change that caused it.
 */
export function commsAliases(): Record<string, string> {
  return {
    // The restored Communications tree keeps its own root so its many
    // internal imports do not collide with the app's '@'.
    '@comms': resolve(COMMS_ROOT),
    // Buzz generated this as a virtual module from its own build; the
    // manifest is just JSON, so point at the recovered file directly.
    '@features-manifest': resolve(COMMS_ROOT, 'preview-features.json'),
    // That tree was written against Tauri. Aliasing its imports onto an
    // Electron-backed shim keeps 52 call sites untouched; nothing from
    // @tauri-apps is installed or shipped.
    '@tauri-apps/api/core': resolve(COMMS_SHIM, 'core.ts'),
    '@tauri-apps/api/event': resolve(COMMS_SHIM, 'event.ts'),
    '@tauri-apps/api/mocks': resolve(COMMS_SHIM, 'mocks.ts'),
    '@tauri-apps/api/window': resolve(COMMS_SHIM, 'desktop.ts'),
    '@tauri-apps/api/webview': resolve(COMMS_SHIM, 'desktop.ts'),
    '@tauri-apps/api/app': resolve(COMMS_SHIM, 'desktop.ts'),
    '@tauri-apps/api/path': resolve(COMMS_SHIM, 'desktop.ts'),
    '@tauri-apps/plugin-opener': resolve(COMMS_SHIM, 'desktop.ts'),
    '@tauri-apps/plugin-process': resolve(COMMS_SHIM, 'desktop.ts'),
    '@tauri-apps/plugin-updater': resolve(COMMS_SHIM, 'desktop.ts'),
    '@tauri-apps/plugin-notification': resolve(COMMS_SHIM, 'desktop.ts')
  }
}
