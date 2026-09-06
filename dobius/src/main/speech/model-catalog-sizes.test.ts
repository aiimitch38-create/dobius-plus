/* Guards the speech catalog's advertised download sizes.
 *
 * Why: these are shown in the Settings model picker and drive the user's
 * choice. Four of them were understated by 2.7x to 9.1x (paraformer claimed
 * 115 MB for a 1,047 MB archive), which is how a model too large to load got
 * selected. The fixtures below are measured Content-Length values, not
 * estimates - re-measure with `curl -sIL <downloadUrl>` before changing one. */

import { describe, expect, it } from 'vitest'

import { SPEECH_MODEL_CATALOG } from './model-catalog'

/** Measured 2026-09-05 via HTTP HEAD (following redirects) on each downloadUrl. */
const MEASURED_ARCHIVE_BYTES: Record<string, number> = {
  'parakeet-tdt-0.6b-v3-int8': 487_200_000,
  'parakeet-tdt-0.6b-v2-int8': 482_500_000,
  'zipformer-bilingual-zh-en': 511_300_000,
  'paraformer-bilingual-zh-en': 1_047_300_000,
  'zipformer-streaming-en-20m': 128_000_000,
  'zipformer-streaming-zh-14m': 74_000_000,
  'whisper-tiny': 116_000_000,
}

/** Content-Length can drift slightly if an asset is re-uploaded; 5% is noise,
 * anything larger means the declared value is wrong again. */
const TOLERANCE = 0.05

describe('speech model catalog sizes', () => {
  const downloadable = SPEECH_MODEL_CATALOG.filter((m) => m.downloadUrl)

  it('covers every downloadable model with a measurement', () => {
    expect(downloadable.length).toBeGreaterThan(0)
    for (const model of downloadable) {
      expect(
        MEASURED_ARCHIVE_BYTES[model.id],
        `${model.id} has a downloadUrl but no measured size fixture`,
      ).toBeDefined()
    }
  })

  it('declares a size for every downloadable model', () => {
    for (const model of downloadable) {
      expect(model.sizeBytes, `${model.id} is missing sizeBytes`).toBeGreaterThan(0)
    }
  })

  it('declares sizes that match what the server actually serves', () => {
    for (const model of downloadable) {
      const measured = MEASURED_ARCHIVE_BYTES[model.id]
      const declared = model.sizeBytes ?? 0
      const drift = Math.abs(declared - measured) / measured
      expect(
        drift,
        `${model.id}: declared ${(declared / 1e6).toFixed(0)} MB but server serves ` +
          `${(measured / 1e6).toFixed(0)} MB`,
      ).toBeLessThan(TOLERANCE)
    }
  })

  it('does not put a size on models with nothing to download', () => {
    for (const model of SPEECH_MODEL_CATALOG.filter((m) => !m.downloadUrl)) {
      expect(model.sizeBytes, `${model.id} advertises a size but has no download`).toBeUndefined()
    }
  })
})
