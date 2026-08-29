export type SpeechModelType = 'transducer' | 'paraformer' | 'whisper' | 'openai'
export type SpeechModelProvider = 'local' | 'openai'

export type ModelingUnit = 'bpe' | 'cjkchar' | 'cjkchar+bpe'

export type SpeechModelManifest = {
  id: string
  label: string
  description: string
  type: SpeechModelType
  provider: SpeechModelProvider
  language: string
  sizeBytes?: number
  downloadUrl?: string
  archiveSha256?: string
  archiveFormat?: 'tar.bz2'
  files?: string[]
  sampleRate: number
  streaming: boolean
  modelingUnit?: ModelingUnit
  recommended?: boolean
}

export type SpeechModelStatus = 'not-downloaded' | 'downloading' | 'extracting' | 'ready' | 'error'

export type SpeechModelState = {
  id: string
  status: SpeechModelStatus
  progress?: number
  error?: string
}

export type SpeechTranscriptEvent = {
  text: string
  sessionId: string
}

export type SpeechLifecycleEvent = {
  sessionId: string
}

export type SpeechErrorEvent = {
  error: string
  sessionId: string
}

export type DictationState = 'idle' | 'starting' | 'listening' | 'stopping' | 'error'

export type UserModelConfig = {
  id: string
  type: SpeechModelType
  dir: string
  sampleRate?: number
}

export type DictationMode = 'toggle' | 'hold'

export type VoiceSettings = {
  enabled: boolean
  sttModel: string
  modelsDir: string
  language: string
  dictationMode: DictationMode
  terminalConfirmBeforeInsert: boolean
  userModels: UserModelConfig[]
  openAiApiKeyConfigured: boolean
  /** When on, run the background Voice Conductor session (routes voice/dispatched work). */
  conductorEnabled: boolean
  /**
   * When on, ⌘T is captured system-wide (Electron globalShortcut) for Jarvis
   * push-to-talk; off leaves ⌘T untouched for every other app.
   */
  jarvisEnabled?: boolean
  /**
   * Experimental: watch dictation finals for a "Hey Adam" wake phrase and route
   * the remainder to ADAM. Costs CPU only while a dictation session is active.
   */
  jarvisWakeWord?: boolean
  /** Base URL of the local ADAM agent service. */
  adamEndpoint?: string
  /** ElevenLabs credentials for spoken replies; empty falls back to the local engine. */
  elevenlabsApiKey?: string
  elevenlabsVoiceId?: string
  elevenlabsModelId?: string
  /** ElevenLabs Agents id; set enables the live conversation instead of turns. */
  elevenlabsAgentId?: string
}

/** HUD-facing conversation phase for the Jarvis voice loop. */
export type JarvisConversationPhase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

export type JarvisStateEvent = {
  state: JarvisConversationPhase
  reason?: string
}

/** Result of asking ADAM a spoken utterance via POST /v1/converse. */
export type JarvisAskResult =
  | { kind: 'answer'; text: string }
  | { kind: 'job'; text: string; jobId?: string }
  | { kind: 'error'; text: string }

export type JarvisSpeakOutcome = {
  played: boolean
  reason?: string
}
