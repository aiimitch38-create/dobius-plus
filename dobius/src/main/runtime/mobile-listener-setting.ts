import type { GlobalSettings } from '../../shared/types'

// Why: the runtime WebSocket binds 0.0.0.0 and lets any paired LAN client
// reach terminal/git/file RPCs, so desktop launches keep it off unless the
// user opted in. `dobius serve` exists only to expose that listener, so an
// explicit serve launch keeps it on.
export function shouldEnableRuntimeWebSocket(args: {
  settings: Pick<GlobalSettings, 'mobileListenerEnabled'> | null | undefined
  isServeMode: boolean
}): boolean {
  if (args.isServeMode) {
    return true
  }
  return args.settings?.mobileListenerEnabled === true
}
