import { app } from 'electron'
import { resolve } from 'node:path'

// Why: the one userData root every main-process store resolves through.
// index.ts captures it (via persistence.initDataPath) after
// configureDevUserDataPath() and before app.setName(). Later
// app.getPath('userData') calls may resolve elsewhere once the name changes,
// which would split data across two directories (bug #53).
let capturedRoot: string | null = null

/** Capture the root once; later calls keep the first value. */
export function captureUserDataRoot(): string {
  if (capturedRoot === null) {
    capturedRoot = app.getPath('userData')
  }
  return capturedRoot
}

export function getUserDataRoot(): string {
  if (capturedRoot !== null) {
    return capturedRoot
  }
  // Why: not cached. A call that runs before capture (tests, or an import-time
  // caller before configureDevUserDataPath) must not pin a pre-redirect path.
  return app.getPath('userData')
}

/**
 * Log when Electron's live userData resolution no longer matches the captured
 * root (e.g. after app.setName). The captured root stays authoritative and the
 * other directory is left untouched. Returns the other directory, or null.
 */
export function reportUserDataRootDivergence(): string | null {
  if (capturedRoot === null) {
    return null
  }
  const live = app.getPath('userData')
  if (resolve(live) === resolve(capturedRoot)) {
    return null
  }
  console.warn(
    `[userData] Electron now resolves userData to ${live}; keeping ${capturedRoot}.` +
      ' The other directory is left untouched.'
  )
  return live
}
