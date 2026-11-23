// Voice mode on/off, its saved setting, and the wake-word tap.
import { getDefaultVoiceSettings } from '../../shared/constants'
import type { VoiceSettings } from '../../shared/speech-types'
import type { Store } from '../persistence'
import { getSpeechSttService } from '../speech/speech-runtime-service'
import { tapSttFinalTranscripts, type JarvisService } from './jarvis-service'

/** Turns voice mode on or off and keeps the setting only when that worked (`jarvis:setMode`). */
export function applyJarvisMode(store: Store, service: JarvisService, active: boolean): { ok: boolean } {
  const ok = service.toggle(active)
  // Why only-on-success: persisting jarvisEnabled=true when the shortcut was
  // refused would retry a broken grab on every relaunch.
  if (ok) {
    persistVoicePatch(store, { jarvisEnabled: active })
  }
  return { ok }
}

function persistVoicePatch(store: Store, patch: Partial<VoiceSettings>): void {
  const current = store.getSettings().voice ?? getDefaultVoiceSettings()
  store.updateSettings({ voice: { ...current, ...patch } }, { notifyListeners: true })
}

export function wireWakeWordObservation(store: Store, service: JarvisService): void {
  // The matcher inside the service no-ops unless voice.jarvisWakeWord is on,
  // so the tap stays permanently installed and cheap while dictation is idle.
  tapSttFinalTranscripts(getSpeechSttService(store), (text) =>
    service.handleAmbientTranscript(text)
  )
}

export function restorePersistedMode(store: Store, service: JarvisService): void {
  if (store.getSettings().voice?.jarvisEnabled !== true) {
    return
  }
  // Why the stored flag is left on (#122-F9): writing false here silently
  // turned the user's switch off whenever another app held ⌘T at launch.
  // The error state toggle() broadcasts here is sent before the renderer
  // listens, so it is not what surfaces this: the renderer asks jarvis:status
  // on mount and toasts (use-jarvis-turn), Settings shows it too, and toggling
  // off and on retries.
  if (!service.toggle(true)) {
    console.warn('[jarvis] Cmd+T is held by another app; Jarvis stays on without the shortcut')
  }
}
