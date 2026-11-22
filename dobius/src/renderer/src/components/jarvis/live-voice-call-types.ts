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
// - DELEGATION_SETTLE: a delegation can arrive before Carson's last words are
//   transcribed; wait for the input transcript to go quiet, up to the max.
// - INTENT_SETTLE: "stop" and "hang up" are checked on a finished phrase,
//   never on a half-transcribed one.
// - IDLE_HANGUP: design doc rule 6, close a call that sat idle for 20 minutes.
// - CONNECT_TIMEOUT: an answer that never turns into session.started is dead.
export const LIVE_SPEAKING_QUIET_MS = 900
export const LIVE_DELEGATION_SETTLE_MS = 500
export const LIVE_DELEGATION_SETTLE_MAX_MS = 2_000
export const LIVE_INTENT_SETTLE_MS = 700
export const LIVE_HANG_UP_GRACE_MS = 2_500
export const LIVE_CAP_HANG_UP_GRACE_MS = 4_000
export const LIVE_IDLE_HANGUP_MS = 20 * 60_000
export const LIVE_CONNECT_TIMEOUT_MS = 20_000
export const LIVE_MAX_PENDING_DELEGATIONS = 2

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
  }) => Promise<LiveDelegateResult>
  liveCancel: (payload: { callToken: string }) => Promise<{ ok: boolean }>
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
