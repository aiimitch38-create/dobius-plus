import type {
  JarvisAskResult,
  JarvisConversationPhase,
  JarvisSpeakOutcome
} from '../../shared/speech-types'
import type { VoiceSettings } from '../../shared/speech-types'
import type { SpeakOutcome } from '../communications/huddles/huddle-speech-synthesis'
import { getHuddleSpeechQueue } from '../communications/huddles/huddle-speech-synthesis'
import type { SttEventSink } from '../speech/stt-service'
import {
  ADAM_UNREACHABLE_TEXT,
  converseWithAdam,
  loadAdamServiceToken
} from './adam-client'
import { resolveElevenLabsConfig, speakWithElevenLabs } from './elevenlabs-client'
import { JARVIS_PTT_AUTO_RELEASE_MS, applyJarvisSignal, type JarvisSignal } from './jarvis-state'
import { createWakeWordMatcher, type WakeWordMatcher } from './wake-word-matcher'

export const JARVIS_SHORTCUT_ACCELERATOR = 'CommandOrControl+T'
export const JARVIS_STATE_CHANNEL = 'jarvis:state'
export const JARVIS_PTT_PRESSED_CHANNEL = 'jarvis:ptt-pressed'
export const JARVIS_PTT_RELEASED_CHANNEL = 'jarvis:ptt-released'

export type JarvisShortcutPort = {
  register(handler: () => void): boolean
  unregister(): void
}

/** Delivers Jarvis events to interested windows (orb HUD + focused window). */
export type JarvisBroadcastPort = (channel: string, payload: unknown) => void

export type JarvisSettingsStore = {
  getSettings(): { voice?: VoiceSettings }
}

export type JarvisServiceDeps = {
  store: JarvisSettingsStore
  broadcast: JarvisBroadcastPort
  shortcut: JarvisShortcutPort
  fetchFn?: typeof fetch
  speakQueue?: (text: string) => Promise<SpeakOutcome>
  now?: () => number
}

/**
 * Main-process brain of the Jarvis voice loop. The renderer drives mic capture
 * and STT through the existing speech IPC; this service owns everything that
 * must live in main: the system-wide ⌘T grab, the ADAM round-trip, spoken
 * output, wake-word watching, and HUD state broadcast.
 */
export class JarvisService {
  private phase: JarvisConversationPhase = 'idle'
  private shortcutActive = false
  private pttReleaseTimer: NodeJS.Timeout | null = null
  private readonly deps: JarvisServiceDeps
  private readonly wakeMatcher: WakeWordMatcher

  constructor(deps: JarvisServiceDeps) {
    this.deps = deps
    const now = deps.now ?? Date.now
    this.wakeMatcher = createWakeWordMatcher({ now })
  }

  isShortcutActive(): boolean {
    return this.shortcutActive
  }

  getPhase(): JarvisConversationPhase {
    return this.phase
  }

  /**
   * Registers/releases the system-wide ⌘T shortcut. Only ever held while Jarvis
   * mode is on — when off, ⌘T belongs to whatever app is focused.
   * Returns false (and broadcasts an error state) when the accelerator could
   * not be claimed, e.g. another app already owns it.
   */
  toggle(active: boolean): boolean {
    if (active) {
      if (this.shortcutActive) {
        return true
      }
      const registered = this.deps.shortcut.register(() => this.handlePttPress())
      if (!registered) {
        this.transition({ type: 'error', reason: 'global-shortcut-unavailable' })
        return false
      }
      this.shortcutActive = true
      this.transition({ type: 'mode-on' })
      return true
    }
    if (this.shortcutActive) {
      this.deps.shortcut.unregister()
      this.shortcutActive = false
    }
    this.clearPttReleaseTimer()
    this.wakeMatcher.reset()
    this.transition({ type: 'mode-off' })
    return true
  }

  /** Asks ADAM; speaks the reply. Never throws — failures come back as results. */
  async ask(utteranceRaw: string): Promise<JarvisAskResult> {
    const utterance = typeof utteranceRaw === 'string' ? utteranceRaw.trim() : ''
    if (!utterance) {
      return { kind: 'error', text: 'No speech detected' }
    }
    this.transition({ type: 'ask-started' })
    let result: JarvisAskResult
    try {
      result = await converseWithAdam({
        endpoint: this.deps.store.getSettings().voice?.adamEndpoint,
        token: loadAdamServiceToken(),
        utterance,
        fetchFn: this.deps.fetchFn
      })
    } catch {
      result = { kind: 'error', text: ADAM_UNREACHABLE_TEXT }
    }
    if (result.kind === 'error') {
      this.transition({ type: 'turn-finished' })
      return result
    }
    await this.speak(result.text)
    return result
  }

  /**
   * Speaks through the shared huddle speech queue, so Jarvis utterances are
   * serialized against each other AND against huddle agent replies — neither
   * can overlap the other's audio.
   */
  async speak(text: string): Promise<JarvisSpeakOutcome> {
    if (typeof text !== 'string' || !text.trim()) {
      return { played: false, reason: 'empty text' }
    }
    this.transition({ type: 'speak-started' })
    // ElevenLabs when Carson's key+voice are configured; local engine stays the
    // fallback so a network/key failure never silences a reply.
    const eleven = resolveElevenLabsConfig()
    if (eleven) {
      try {
        await speakWithElevenLabs(text.trim(), eleven)
        this.transition({ type: 'turn-finished' })
        return { played: true }
      } catch {
        // fall through to the huddle/local engine below
      }
    }
    let outcome: SpeakOutcome
    try {
      outcome = await (this.deps.speakQueue ?? this.getDefaultSpeakQueue())(text)
    } catch (error) {
      outcome = { played: false, reason: error instanceof Error ? error.message : String(error) }
    }
    this.transition({ type: 'turn-finished' })
    return outcome.played ? { played: true } : { played: false, reason: outcome.reason }
  }

  /**
   * Wake-word entry point. Fed every STT final transcript while any dictation
   * session runs; only acts when the experimental flag is on.
   */
  handleAmbientTranscript(transcript: string): void {
    if (this.deps.store.getSettings().voice?.jarvisWakeWord !== true) {
      return
    }
    const utterance = this.wakeMatcher.feed(transcript)
    if (utterance) {
      void this.ask(utterance).catch(() => undefined)
    }
  }

  dispose(): void {
    if (this.shortcutActive) {
      this.deps.shortcut.unregister()
      this.shortcutActive = false
    }
    this.clearPttReleaseTimer()
    this.wakeMatcher.reset()
  }

  private handlePttPress(): void {
    // globalShortcut cannot distinguish press from release; emit pressed now
    // and a synthetic released shortly after so renderer listeners stay simple.
    this.deps.broadcast(JARVIS_PTT_PRESSED_CHANNEL, { at: Date.now() })
    this.clearPttReleaseTimer()
    const timer = setTimeout(() => {
      this.pttReleaseTimer = null
      this.deps.broadcast(JARVIS_PTT_RELEASED_CHANNEL, { at: Date.now() })
    }, JARVIS_PTT_AUTO_RELEASE_MS)
    timer.unref?.()
    this.pttReleaseTimer = timer
  }

  private clearPttReleaseTimer(): void {
    if (this.pttReleaseTimer) {
      clearTimeout(this.pttReleaseTimer)
      this.pttReleaseTimer = null
    }
  }

  private transition(signal: JarvisSignal): void {
    this.phase = applyJarvisSignal(this.phase, signal)
    const payload =
      signal.type === 'error' && signal.reason
        ? { state: this.phase, reason: signal.reason }
        : { state: this.phase }
    this.deps.broadcast(JARVIS_STATE_CHANNEL, payload)
  }

  // Why lazy: resolve the shared queue only when no test injected one, so the
  // huddle singleton is not created as a side effect of constructing the service.
  private getDefaultSpeakQueue(): (text: string) => Promise<SpeakOutcome> {
    return getHuddleSpeechQueue()
  }
}

let jarvisServiceSingleton: JarvisService | null = null

export function getJarvisService(deps: JarvisServiceDeps): JarvisService {
  jarvisServiceSingleton ??= new JarvisService(deps)
  return jarvisServiceSingleton
}

export function peekJarvisService(): JarvisService | null {
  return jarvisServiceSingleton
}

type SttDictationStarter = (
  modelId: string,
  sink: SttEventSink,
  hotwordsFilePath?: string,
  owner?: string
) => Promise<void>

const tappedSttServices = new WeakSet<object>()

/**
 * Observes STT final transcripts without touching SttService ownership.
 *
 * Why wrap the instance method: SttService keeps exactly ONE event sink, owned
 * by whoever starts dictation (the window-level speech IPC). There is no
 * subscribe API, so tapping startDictation lets Jarvis see finals alongside the
 * legitimate owner instead of stealing or duplicating sink state.
 */
export function tapSttFinalTranscripts(
  stt: { startDictation: SttDictationStarter },
  onFinal: (text: string) => void
): () => void {
  if (tappedSttServices.has(stt)) {
    return () => undefined
  }
  tappedSttServices.add(stt)
  const original = stt.startDictation.bind(stt)
  stt.startDictation = async (...args: Parameters<SttDictationStarter>) => {
    const [modelId, sink, ...rest] = args
    const tappedSink: SttEventSink = (event) => {
      if (event.type === 'final') {
        onFinal(event.text ?? '')
      }
      sink(event)
    }
    return original(modelId, tappedSink, ...rest)
  }
  return () => {
    stt.startDictation = original
  }
}
