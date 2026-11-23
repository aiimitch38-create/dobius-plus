import type {
  LiveDelegateResult,
  LiveVoiceSessionReport,
  OpenAiLiveSessionResult
} from '../../../../shared/speech-types'

export type LiveVoiceState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'standby'
  | 'error'

export type LiveVoiceSnapshot = {
  state: LiveVoiceState
  muted: boolean
  errorText: string | null
}

export function sameSnapshot(a: LiveVoiceSnapshot, b: LiveVoiceSnapshot): boolean {
  return a.state === b.state && a.muted === b.muted && a.errorText === b.errorText
}

/** One spoken line ADAM never saw; itemId is stable so a resend is saved once. */
export type LiveTranscriptLine = { role: 'user' | 'assistant'; text: string; itemId: string }

// Why each number:
// - SPEAKING_QUIET: the Live API sends no "reply finished" event (design doc
//   section 1.5), so the voice counts as done after this much transcript quiet.
// - SPEAKING_SILENCE / OUTPUT_AUDIBLE: the transcript runs ahead of the audio, so
//   speaking also lasts until the played-back level has been below AUDIBLE for
//   this long. One grace window across word gaps keeps the state from flapping.
// - DELEGATION_SETTLE: a delegation can arrive before Carson's last words are
//   transcribed; wait for the input transcript to go quiet, up to the max.
// - INTENT_SETTLE: "stop" and "hang up" are checked on a finished phrase,
//   never on a half-transcribed one.
// - IDLE_HANGUP: design doc rule 6, close a call that sat idle for 20 minutes.
// - CONNECT_TIMEOUT: an answer that never turns into session.started is dead.
export const LIVE_SPEAKING_QUIET_MS = 900
export const LIVE_SPEAKING_SILENCE_MS = 1_000
export const LIVE_SPEAKING_POLL_MS = 100
export const LIVE_OUTPUT_AUDIBLE_LEVEL = 0.03
export const LIVE_DELEGATION_SETTLE_MS = 500
export const LIVE_DELEGATION_SETTLE_MAX_MS = 2_000
export const LIVE_INTENT_SETTLE_MS = 700
export const LIVE_HANG_UP_GRACE_MS = 2_500
export const LIVE_CAP_HANG_UP_GRACE_MS = 4_000
export const LIVE_IDLE_HANGUP_MS = 20 * 60_000
export const LIVE_CONNECT_TIMEOUT_MS = 20_000
export const LIVE_MAX_PENDING_DELEGATIONS = 2
// - REPORT_QUIET: a conductor report waits until Carson has been quiet this long,
//   so ADAM never starts talking into the gap between two of his phrases.
export const LIVE_REPORT_QUIET_MS = 2_500
// Why 100ms: the microphone is sampled between checks too, so a word said
// between two samples still restarts the quiet window.
export const LIVE_REPORT_POLL_MS = 100
// - PROGRESS_*: "still working" lines are skipped when Carson spoke in the last
//   30 seconds, and at most one is said every 2 minutes.
export const LIVE_PROGRESS_AFTER_SPEECH_MS = 30_000
export const LIVE_PROGRESS_MIN_GAP_MS = 2 * 60_000

export const LIVE_NOT_HEARD_TEXT = 'Sorry, I did not catch that. Could you say it again?'
export const LIVE_UNREACHABLE_TEXT = 'I could not reach ADAM just now. Try again in a moment.'
export const LIVE_DROPPED_TEXT = 'The live call dropped. Press the orb to call again.'

export type LevelReader = { read: () => number; dispose: () => void }

export type TrackLike = { enabled: boolean; stop: () => void }

export type MicStreamLike = {
  getAudioTracks: () => TrackLike[]
  getTracks: () => TrackLike[]
}

export type DataChannelLike = {
  readyState: string
  send: (data: string) => void
  close: () => void
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
}

export type PeerLike = {
  connectionState: string
  addTrack: (track: TrackLike, stream: MicStreamLike) => unknown
  createDataChannel: (label: string) => DataChannelLike
  createOffer: () => Promise<{ sdp?: string }>
  setLocalDescription: (description: { sdp?: string; type?: string }) => Promise<void>
  setRemoteDescription: (description: { type: 'answer'; sdp: string }) => Promise<void>
  close: () => void
  ontrack: ((event: { streams: readonly unknown[] }) => void) | null
  onconnectionstatechange: (() => void) | null
}

export type LiveVoiceApi = {
  liveSessionConnect: (offerSdp: string) => Promise<OpenAiLiveSessionResult>
  liveSessionReport: (report: LiveVoiceSessionReport) => Promise<{ ok: boolean }>
  liveDelegate: (request: {
    request: string
    callLines: string[]
    callToken: string
    /** The voice model's delegation id, so ADAM's progress notes name it. */
    delegationId?: string | null
  }) => Promise<LiveDelegateResult>
  liveCancel: (payload: { callToken: string }) => Promise<{ ok: boolean }>
  /** Writes a failure to the voice error log in main; optional so test doubles may omit it. */
  liveLog?: (payload: { text: string }) => Promise<{ ok: boolean }>
  liveTranscript: (line: LiveTranscriptLine & { callToken: string }) => Promise<{ ok: boolean }>
}

export type LiveVoiceCallDeps = {
  api: LiveVoiceApi
  createPeer: () => PeerLike
  getMicrophone: () => Promise<MicStreamLike>
  /** Plays the voice; returns a function that stops it. */
  playRemote: (stream: unknown) => () => void
  /** A 0..1 level reader for a stream, for the orb. */
  levelOf?: (stream: unknown) => LevelReader | null
  setTimeout?: (handler: () => void, ms: number) => number
  clearTimeout?: (timer: number) => void
  now?: () => number
}

/** One open WebRTC leg of a call. */
export type LivePeerCall = {
  peer: PeerLike
  channel: DataChannelLike
  mic: MicStreamLike
  /** True once main has the session as this window's active call. */
  connected: boolean
  stopAudio: (() => void) | null
}
