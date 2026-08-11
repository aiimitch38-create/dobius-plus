// Mic loudness for the dictation orb, derived from the capture stream that
// already feeds speech recognition — the orb must never open a second
// microphone, which would double the macOS mic indicator and TCC prompts.

// Speech RMS sits around 0.02-0.2 after the capture chain's AGC; this scale
// puts ordinary talking across the 0..1 range the orb animates over.
const RMS_TO_LEVEL_SCALE = 8

// Capture chunks land ~85ms apart, so a level held flat between them keeps the
// orb agitated after speech stops. Fade the last reading out over this window.
const LEVEL_DECAY_MS = 400

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

export function decayAudioLevel(level: number, elapsedMs: number): number {
  if (elapsedMs >= LEVEL_DECAY_MS) {
    return 0
  }
  return level * Math.max(0, 1 - elapsedMs / LEVEL_DECAY_MS)
}
