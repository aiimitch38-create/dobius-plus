// Mic loudness for the dictation orb, derived from the capture stream that
// already feeds speech recognition — the orb must never open a second
// microphone, which would double the macOS mic indicator and TCC prompts.

// Speech RMS sits around 0.02-0.2 after the capture chain's AGC; this scale
// puts ordinary talking across the 0..1 range the orb animates over.
const RMS_TO_LEVEL_SCALE = 8

// Capture chunks land ~85ms apart. Hold the last reading until well past that
// so the orb sees a steady value between chunks; ramping it down here produced
// a ~12Hz sawtooth that read as jitter. Smoothing belongs in the render loop,
// which runs per frame and can shape attack and release independently.
const LEVEL_STALE_MS = 500

export function audioLevelFromSamples(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0
  }
  let squareSum = 0
  for (let i = 0; i < samples.length; i += 1) {
    squareSum += samples[i] * samples[i]
  }
  const rms = Math.sqrt(squareSum / samples.length)
  return Math.min(rms * RMS_TO_LEVEL_SCALE, 1)
}

/** Hold the last measured level, but treat a stalled capture as silence. */
export function holdAudioLevel(level: number, elapsedMs: number): number {
  return elapsedMs > LEVEL_STALE_MS ? 0 : level
}
