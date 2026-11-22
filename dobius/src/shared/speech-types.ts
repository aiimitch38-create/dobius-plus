export type SpeechModelType = 'transducer' | 'paraformer' | 'whisper' | 'openai' | 'vps'
export type SpeechModelProvider = 'local' | 'openai' | 'vps'

export type ModelingUnit = 'bpe' | 'cjkchar' | 'cjkchar+bpe'

export type SpeechModelManifest = {
  id: string
  label: string
  description: string
  type: SpeechModelType
  provider: SpeechModelProvider
  language: string
  /** Compressed download size in bytes, NOT installed size. Measure it with
   * `curl -sIL <downloadUrl>` (Content-Length); do not estimate. Archives
   * expand substantially - Parakeet v3 is a 487 MB download that occupies
   * ~640 MB on disk. */
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
  /** Base URL of the self-hosted Parakeet speech server (Tailscale). */
  vpsSttEndpoint?: string
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
  /**
   * When not explicitly false, clicking the orb talks to Adam's real Hermes
   * profile (his own identity, his own voice) instead of the ElevenLabs live
   * agent, even when an ElevenLabs agent id is configured. Defaults to true
   * (undefined counts as on) so existing installs get this without a manual
   * settings trip; set false to go back to the ElevenLabs conversation.
   */
  preferNativeAdamVoice?: boolean
  /**
   * Which engine the orb's voice uses; defaults to OpenAI Live. Settings saved
   * before the choice existed are migrated on load (resolveLiveVoiceEngine).
   * Without a saved OpenAI key the orb runs the fallback engine instead.
   */
  liveVoiceEngine?: LiveVoiceEngine
  /** OpenAI Live voice name; fixed for the length of one session. */
  openAiLiveVoice?: string
  /** Push-to-talk keeps the microphone muted until the shortcut is pressed. */
  liveVoiceMicMode?: LiveVoiceMicMode
  /** Daily spending cap for OpenAI Live, in US dollars. */
  liveVoiceDailyCapUsd?: number
  /** Seconds of silence before an OpenAI Live session drops to standby. */
  liveVoiceIdleTimeoutSec?: number
}

export type LiveVoiceEngine = 'hermes' | 'elevenlabs' | 'openai-live'

export type LiveVoiceMicMode = 'push-to-talk' | 'hands-free'

/** Why a kind: Settings picks plain-English help per cause, not per message. */
export type OpenAiLiveErrorKind =
  | 'invalid-offer'
  | 'busy'
  | 'not-allowed'
  | 'not-ready'
  | 'cancelled'
  | 'no-key'
  | 'key-unreadable'
  | 'bad-key'
  | 'no-access'
  | 'no-billing'
  | 'rate-limited'
  | 'network'
  | 'timeout'
  | 'server'
  | 'rejected'
  | 'bad-response'
  | 'over-cap'
  | 'meter-unavailable'

export type OpenAiLiveFailure = { ok: false; kind: OpenAiLiveErrorKind; error: string }

/** What the window gets back from a session create: never the API key. */
export type OpenAiLiveSessionResult =
  | {
      ok: true
      answerSdp: string
      sessionId: string | null
      /** Set by main's IPC: every later call message must carry it. */
      callToken?: string
    }
  | OpenAiLiveFailure

/** What main says back for one delegated request on a live call. */
export type LiveDelegateResult =
  | { ok: true; kind: JarvisAskResult['kind']; speak: string }
  | { ok: false; error: string }

/** Main tells the window owning a live call about the spending cap. */
export type LiveVoiceNotice = { kind: 'cap-warning' | 'cap-reached'; text: string }

/** Session events the window reports to main's spend meter. */
export type LiveVoiceSessionReport = {
  type: 'paused' | 'resumed' | 'closed'
  callToken: string
}

/** ElevenLabs key status sent to Settings; the key itself never is (#24). */
export type ElevenLabsKeyStatus = {
  configured: boolean
  /** Key could not be encrypted: works until quit, not on disk. */
  sessionOnly: boolean
  /** A key file exists but this build cannot decrypt it. */
  unreadable: boolean
}

/** HUD-facing conversation phase for the Jarvis voice loop. */
export type JarvisConversationPhase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error'

export type JarvisStateEvent = {
  state: JarvisConversationPhase
  reason?: string
}

/** Result of asking Adam through the selected voice backend. */
export type JarvisAskResult =
  | { kind: 'cancelled'; text: '' }
  | { kind: 'answer'; text: string }
  | { kind: 'job'; text: string; jobId?: string }
  | { kind: 'error'; text: string }

/** The project on Carson's screen when he started talking or typing; tells ADAM what "this project" means. */
export type AdamLookingAt = { project: string; workspace: string; folder: string | null }

/** One saved row of ADAM's thread. Main owns the thread; extra fields (tone, voice, report) pass through. */
export type AdamThreadRow = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  [extra: string]: unknown
}

/**
 * Which way in a turn with ADAM came from. All share one Hermes session. `cli`
 * is `dobius adam ask`; main writes its rows, as it does for voice.
 */
export type AdamTurnSource = 'voice' | 'thread' | 'cli'

/** Sent to the window for each accepted ADAM turn: first the words asked, then the reply. */
export type AdamTurnEvent = {
  turnId: string
  source: AdamTurnSource
  at: number
} & (
  | { phase: 'asked'; text: string }
  | { phase: 'answered'; result: JarvisAskResult }
)

export type JarvisSpeakOutcome = {
  played: boolean
  reason?: string
}
