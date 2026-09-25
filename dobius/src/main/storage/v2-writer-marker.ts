import { existsSync } from 'node:fs'
import path from 'node:path'
import { writeJsonFileAtomic } from './safe-json-file'
import { getUserDataRoot } from './user-data-root'

// Why: the legacy V1 app (repo-root electron/) shares this userData dir. It
// refuses to start or write while this file exists (electron/v2-writer-guard.js
// holds the same name), so V1 cannot overwrite V2-owned data (bug #52).
// Older builds of either app ignore the file.
export const V2_WRITER_MARKER_FILE = 'dobius-v2-writer.json'

export type V2WriterMarkerResult = 'created' | 'present' | 'failed'

/** Claim the userData root for V2. Never overwrites an existing marker. */
export function claimV2WriterMarker(
  appVersion: string,
  root: string = getUserDataRoot()
): V2WriterMarkerResult {
  const markerPath = path.join(root, V2_WRITER_MARKER_FILE)
  if (existsSync(markerPath)) {
    return 'present'
  }
  try {
    writeJsonFileAtomic(markerPath, {
      writer: 'dobius-v2',
      claimedAt: new Date().toISOString(),
      appVersion
    })
    return 'created'
  } catch (error) {
    // Why not fatal: V2 data is still safe to use; only the V1 lock-out is missing.
    console.warn(`[userData] could not write ${markerPath}; legacy V1 is not locked out:`, error)
    return 'failed'
  }
}
