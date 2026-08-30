import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { downloadFileOverHttps } from './local-tts'

/**
 * Main-side half of VAD endpointing: fetching and locating the silero model.
 * The pure decision logic lives in silence-endpointer.ts, which the STT
 * worker bundles (this file cannot go there — it pulls in electron).
 */

/** Pinned against the sherpa-onnx `asr-models` release, verified 2026-08-29. */
export const SILERO_VAD_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad_v5.onnx'
export const SILERO_VAD_FILENAME = 'silero_vad_v5.onnx'

export function resolveSileroVadModelPath(modelsRoot: string): string | null {
  const path = join(modelsRoot, SILERO_VAD_FILENAME)
  return existsSync(path) ? path : null
}

let sileroDownload: Promise<void> | null = null

/**
 * Fire-and-forget friendly: ~2 MB, plain .onnx (no tarball). In-flight
 * guarded so concurrent dictation starts trigger one download.
 */
export function ensureSileroVadModel(
  modelsRoot: string,
  download: (url: string, dest: string) => Promise<void> = downloadFileOverHttps
): Promise<void> {
  if (resolveSileroVadModelPath(modelsRoot)) {
    return Promise.resolve()
  }
  sileroDownload ??= download(SILERO_VAD_URL, join(modelsRoot, SILERO_VAD_FILENAME)).finally(
    () => {
      sileroDownload = null
    }
  )
  return sileroDownload
}
