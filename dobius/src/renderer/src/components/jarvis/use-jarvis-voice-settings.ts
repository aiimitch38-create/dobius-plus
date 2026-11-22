import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import {
  resolveActiveVoiceEngine,
  resolveLiveVoiceSettings,
  type LiveVoiceSettings
} from '../../../../shared/live-voice-settings'
import type { LiveVoiceEngine, VoiceSettings } from '../../../../shared/speech-types'

export type JarvisVoiceFlags = {
  jarvisEnabled: boolean
  sttModel: string
  jarvisWakeWord: boolean
  /** Non-empty switches ⌘T from one-shot turns to a live agent conversation. */
  agentId: string
  /**
   * True unless the orb should run the ElevenLabs live conversation. Derived
   * from activeVoiceEngine, so it already includes the no-key fallback.
   */
  preferNativeAdamVoice: boolean
  /** The engine chosen in Settings, plus voice, mic mode, cap and idle timeout. */
  liveVoice: LiveVoiceSettings
  /** The engine the orb runs right now; differs from the choice on fallback. */
  activeVoiceEngine: LiveVoiceEngine
}

export function toJarvisVoiceFlags(next: VoiceSettings | undefined): JarvisVoiceFlags {
  const activeVoiceEngine = resolveActiveVoiceEngine(next)
  return {
    jarvisEnabled: next?.jarvisEnabled === true,
    sttModel: next?.sttModel ?? '',
    jarvisWakeWord: next?.jarvisWakeWord === true,
    agentId: typeof next?.elevenlabsAgentId === 'string' ? next.elevenlabsAgentId.trim() : '',
    preferNativeAdamVoice: activeVoiceEngine !== 'elevenlabs',
    liveVoice: resolveLiveVoiceSettings(next),
    activeVoiceEngine
  }
}

/**
 * Reads the persisted voice settings over IPC. The orb window mounts outside
 * <App>, so the Zustand store is never hydrated there — follow changes pushed
 * by the settings writer instead of the store.
 */
export function useJarvisVoiceSettings(): {
  flags: JarvisVoiceFlags
  flagsRef: { current: JarvisVoiceFlags }
} {
  const [flags, setFlags] = useState<JarvisVoiceFlags>(() => toJarvisVoiceFlags(undefined))
  const flagsRef = useRef(flags)

  useEffect(() => {
    let cancelled = false
    const applyVoice = (next: VoiceSettings | undefined): void => {
      const value = toJarvisVoiceFlags(next)
      flagsRef.current = value
      setFlags(value)
    }
    void window.api.settings
      .get()
      .then((settings) => {
        if (!cancelled) {
          applyVoice(settings.voice)
        }
      })
      .catch(() => {})
    const unsubscribe = window.api.settings.onChanged((updates) => {
      if ('voice' in updates) {
        applyVoice(updates.voice as VoiceSettings | undefined)
      }
    })
    // Why also the store: main never sends settings:changed back to the window
    // that made the change, and Settings > Voice lives in this same window.
    const unsubscribeStore = useAppStore.subscribe((state, prev) => {
      const voice = state.settings?.voice
      if (voice && voice !== prev.settings?.voice) {
        applyVoice(voice)
      }
    })
    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeStore()
    }
  }, [])

  return { flags, flagsRef }
}
