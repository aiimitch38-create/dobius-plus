import { useEffect, useRef, useState } from 'react'
import type { VoiceSettings } from '../../../../shared/speech-types'

export type JarvisVoiceFlags = {
  jarvisEnabled: boolean
  sttModel: string
  jarvisWakeWord: boolean
  /** Non-empty switches ⌘T from one-shot turns to a live agent conversation. */
  agentId: string
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
  const [flags, setFlags] = useState<JarvisVoiceFlags>({
    jarvisEnabled: false,
    sttModel: '',
    jarvisWakeWord: false,
    agentId: ''
  })
  const flagsRef = useRef(flags)

  useEffect(() => {
    let cancelled = false
    const applyVoice = (next: VoiceSettings | undefined): void => {
      const value: JarvisVoiceFlags = {
        jarvisEnabled: next?.jarvisEnabled === true,
        sttModel: next?.sttModel ?? '',
        jarvisWakeWord: next?.jarvisWakeWord === true,
        agentId: next?.elevenlabsAgentId?.trim() ?? ''
      }
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
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return { flags, flagsRef }
}
