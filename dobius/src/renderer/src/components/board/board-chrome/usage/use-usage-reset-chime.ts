import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { ProviderRateLimits, RateLimitState } from '../../../../../../shared/rate-limit-types'
import { detectUsageResets, usageWindows, type UsageWindows } from '../board-usage-levels'
import { USAGE_PROVIDER_ORDER, type UsageProviderId } from './board-usage-model'

/** Every provider the rate-limit service has reported, in display order. */
export function usageProviderList(rateLimits: RateLimitState): ProviderRateLimits[] {
  const byProvider: Record<UsageProviderId, ProviderRateLimits | null> = {
    claude: rateLimits.claude,
    codex: rateLimits.codex,
    gemini: rateLimits.gemini,
    'opencode-go': rateLimits.opencodeGo,
    kimi: rateLimits.kimi,
    minimax: rateLimits.minimax
  }
  return USAGE_PROVIDER_ORDER.map((p) => byProvider[p]).filter(
    (p): p is ProviderRateLimits => p !== null
  )
}

// Why: a short tone in the renderer; the user's notification sound when one is
// set, otherwise a 0.2 s beep. Nothing leaves the machine.
function playResetChime(): void {
  void window.api.notifications
    .playSound({ force: true })
    .then((result) => {
      if (!result.played) {
        playFallbackBeep()
      }
    })
    .catch(playFallbackBeep)
}

function playFallbackBeep(): void {
  try {
    const audio = new AudioContext()
    const tone = audio.createOscillator()
    const gain = audio.createGain()
    tone.frequency.value = 880
    gain.gain.setValueAtTime(0.08, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.2)
    tone.connect(gain).connect(audio.destination)
    tone.start()
    tone.stop(audio.currentTime + 0.2)
    tone.onended = () => void audio.close()
  } catch (error) {
    console.warn('[board-usage] reset chime could not play', error)
  }
}

/** Chimes once when any provider window resets, if the user turned the chime on. */
export function useUsageResetChime(): void {
  useEffect(() => {
    let last: UsageWindows = usageWindows(usageProviderList(useAppStore.getState().rateLimits))
    return useAppStore.subscribe((state, prev) => {
      if (state.rateLimits === prev.rateLimits) {
        return
      }
      const next = usageWindows(usageProviderList(state.rateLimits))
      // Windows missing from this reading (fetching, error) keep their last value.
      const merged = { ...last, ...next }
      const resets = detectUsageResets(last, next)
      last = merged
      if (resets.length > 0 && state.settings?.boardUsageResetChime === true) {
        playResetChime()
      }
    })
  }, [])
}
