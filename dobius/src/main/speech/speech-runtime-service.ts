import { ModelManager } from './model-manager'
import { SttService } from './stt-service'
import { LocalTts } from './local-tts'
import { LocalSpeaker } from './local-tts-speaker'
import type { VoiceSettings } from '../../shared/speech-types'

type SpeechSettingsStore = {
  getSettings(): {
    voice?: VoiceSettings
  }
}

let modelManager: ModelManager | null = null
let sttService: SttService | null = null
let localTts: LocalTts | null = null
let localSpeaker: LocalSpeaker | null = null

export function getSpeechModelManager(store: SpeechSettingsStore): ModelManager {
  if (!modelManager) {
    const settings = store.getSettings()
    const customDir = settings.voice?.modelsDir || undefined
    modelManager = new ModelManager(customDir || undefined)
  }
  return modelManager
}

export function getSpeechSttService(store: SpeechSettingsStore): SttService {
  if (!sttService) {
    sttService = new SttService(getSpeechModelManager(store))
  }
  return sttService
}

export function getLocalTts(store: SpeechSettingsStore): LocalTts {
  localTts ??= new LocalTts({
    // Reuse the manager's prepared dir so TTS models land beside the STT ones
    // and inherit the ASCII-cache migration handling.
    modelsRoot: getSpeechModelManager(store).getModelsDir(),
    getEngine: () => (store.getSettings().voice?.localTtsEngine === 'supertonic' ? 'supertonic' : 'kokoro')
  })
  return localTts
}

export function getLocalSpeaker(store: SpeechSettingsStore): LocalSpeaker {
  localSpeaker ??= new LocalSpeaker({
    synthesize: (text) => getLocalTts(store).synthesize(text)
  })
  return localSpeaker
}
