import type { PrepareClaudeLaunch } from './agent-runner'

// Why: RPC callers (CLI `agents run`) have no IPC registration path to hand in a
// launch preparer per call, so the app registers its preparer once at boot.
let defaultPrepareClaudeLaunch: PrepareClaudeLaunch | null = null
const registeredListeners = new Set<() => void>()

export function setDefaultPrepareClaudeLaunch(prepare: PrepareClaudeLaunch): void {
  defaultPrepareClaudeLaunch = prepare
  for (const listener of registeredListeners) {
    listener()
  }
}

/** Why: boot-time services (Voice Conductor) sync before the main window registers the preparer. */
export function onDefaultPrepareClaudeLaunchRegistered(listener: () => void): () => void {
  registeredListeners.add(listener)
  return () => registeredListeners.delete(listener)
}

export function getDefaultPrepareClaudeLaunch(): PrepareClaudeLaunch | null {
  return defaultPrepareClaudeLaunch
}
