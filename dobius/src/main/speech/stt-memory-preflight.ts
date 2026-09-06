/* Why this exists: loading a speech model allocates an ONNX Runtime arena
sized roughly to the model's weights. When that allocation fails, sherpa-onnx
aborts inside native code (`onnxruntime::BFCArena::Extend` -> `operator new` ->
SIGTRAP). That abort is NOT a JS exception, so the try/catch in stt-worker's
handleInit cannot see it, and because STT runs in a worker_thread inside the
main Electron process, the abort kills the whole app.

Root-caused 2026-09-05: three identical crashes in 37 minutes. The active model
(parakeet-tdt-0.6b-v3-int8) has a 622 MB encoder; the machine had ~67 MB free.

This module turns that unsurvivable crash into a normal error the UI can show.

ponytail: heuristic, not a guarantee. os.freemem() on macOS reports genuinely
free pages and ignores inactive/purgeable memory the kernel could reclaim, so it
under-reports what is really available. We deliberately accept occasional false
refusals: refusing dictation shows a message the user can act on, while guessing
wrong in the other direction takes the entire app down with unsaved work. The
upgrade path is to run STT in a child process (Electron utilityProcess) so a
native abort kills only the transcriber, at which point this check can relax or
disappear entirely. */

import { statSync } from 'node:fs'
import { join } from 'node:path'
import { freemem } from 'node:os'

/** Weight files are memory-resident once loaded; other files (vocab, config)
 * are negligible. Only these extensions count toward the estimate. */
const WEIGHT_EXTENSIONS = ['.onnx', '.bin']

/** Fraction of the model's on-disk weight size that must be free before we
 * attempt a load. Below 1.0 because macOS can reclaim inactive pages that
 * freemem() does not report; above 0 because the arena needs real pages. */
const REQUIRED_FREE_RATIO = 0.75

export class SttOutOfMemoryError extends Error {
  readonly requiredBytes: number
  readonly freeBytes: number

  constructor(requiredBytes: number, freeBytes: number) {
    super(
      `Not enough free memory to load the speech model. ` +
        `Needs about ${formatMb(requiredBytes)} free, but only ${formatMb(freeBytes)} is available. ` +
        `Close some apps or windows and try again.`,
    )
    this.name = 'SttOutOfMemoryError'
    this.requiredBytes = requiredBytes
    this.freeBytes = freeBytes
  }
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`
}

function isWeightFile(name: string): boolean {
  return WEIGHT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))
}

/**
 * Sum the on-disk size of a model's weight files. Missing or unreadable files
 * contribute 0 rather than throwing: a genuinely missing model is the model
 * manager's error to report, not this check's.
 */
export function estimateModelBytes(modelDir: string, files: readonly string[]): number {
  return files.filter(isWeightFile).reduce((total, file) => {
    try {
      return total + statSync(join(modelDir, file)).size
    } catch {
      return total
    }
  }, 0)
}

/**
 * Throw SttOutOfMemoryError if loading this model would very likely abort the
 * process. Returns silently when the load looks survivable, and when the model
 * size cannot be determined (no weight files found) — an unknown size is not
 * evidence of a problem.
 */
export function assertEnoughMemoryForModel(
  modelDir: string,
  files: readonly string[],
  freeBytesOverride?: number,
): void {
  const modelBytes = estimateModelBytes(modelDir, files)
  if (modelBytes === 0) {
    return
  }

  const freeBytes = freeBytesOverride ?? freemem()
  const requiredBytes = modelBytes * REQUIRED_FREE_RATIO

  if (freeBytes < requiredBytes) {
    throw new SttOutOfMemoryError(requiredBytes, freeBytes)
  }
}
