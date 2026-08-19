/**
 * In-memory state machine for the Communications "huddle" (voice call with a
 * human + AI agents). Dobius is a single desktop user, so there is exactly
 * one huddle at a time — this mirrors the Tauri backend's singleton
 * `HuddleState` (see vendor/buzz-desktop src-tauri/src/huddle/mod.rs, whose
 * shape HuddleBar.tsx's local `HuddleState` type mirrors).
 *
 * Field names are snake_case because this object is returned verbatim to the
 * vendored Buzz frontend, which reads `state.agent_pubkeys` etc. directly —
 * matching the wire contract beats camelCase convention here.
 */
import { randomUUID } from 'node:crypto'

export type HuddlePhase = 'idle' | 'creating' | 'connecting' | 'connected' | 'active' | 'leaving'

export type VoiceInputMode = 'push_to_talk' | 'voice_activity'

export type HuddleState = {
  phase: HuddlePhase
  parent_channel_id: string | null
  ephemeral_channel_id: string | null
  participants: string[]
  agent_pubkeys: string[]
  tts_enabled: boolean
  transcription_enabled: boolean
  is_creator: boolean
  voice_input_mode: VoiceInputMode
}

export type StartHuddleInput = {
  parentChannelId: string
  memberPubkeys: string[]
  callerPubkey: string
}

export type JoinHuddleInput = {
  parentChannelId: string
  ephemeralChannelId: string
  callerPubkey: string
}

export type AddAgentInput = {
  pubkey: string
}

const DEFAULT_VOICE_INPUT_MODE: VoiceInputMode = 'voice_activity'

function defaultState(voiceInputMode: VoiceInputMode): HuddleState {
  return {
    phase: 'idle',
    parent_channel_id: null,
    ephemeral_channel_id: null,
    participants: [],
    agent_pubkeys: [],
    tts_enabled: true,
    transcription_enabled: true,
    is_creator: false,
    voice_input_mode: voiceInputMode
  }
}

/** Phases in which a huddle is considered "in progress" for gating purposes. */
const IN_PROGRESS_PHASES: ReadonlySet<HuddlePhase> = new Set([
  'creating',
  'connecting',
  'connected',
  'active'
])

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
}

/**
 * Matches the Rust backend's message format exactly. HuddleContext.tsx's
 * `isRedundantHuddlePhaseError` regex (`/^cannot (?:start|join) huddle:
 * already in phase /i`) depends on this literal text to silently swallow a
 * redundant start/join instead of surfacing an error banner — changing the
 * wording breaks that UI behavior.
 */
function phaseConflictMessage(action: 'start' | 'join', phase: HuddlePhase): string {
  return `cannot ${action} huddle: already in phase ${phase}`
}

export type HuddleSessionStore = {
  getState: () => HuddleState
  start: (input: StartHuddleInput) => { ephemeral_channel_id: string }
  join: (input: JoinHuddleInput) => { ephemeral_channel_id: string }
  confirmActive: () => HuddleState
  leave: () => HuddleState
  end: () => HuddleState
  addAgent: (input: AddAgentInput) => HuddleState
  setVoiceInputMode: (mode: VoiceInputMode) => HuddleState
  setTranscriptionEnabled: (enabled: boolean) => HuddleState
  setTtsEnabled: (enabled: boolean) => HuddleState
  reconnectAudio: () => HuddleState
}

/**
 * Factory (not a bare singleton export) so tests get an isolated store per
 * case. `getHuddleSessionStore` below wraps this in the process-wide
 * singleton the RPC methods actually use.
 */
export function createHuddleSessionStore(): HuddleSessionStore {
  // voice_input_mode is the one field that survives leave/end — the frontend
  // fetches it once on mount to "stay in sync after remount/recovery",
  // implying it is a durable preference, not a per-huddle toggle.
  let persistedVoiceInputMode: VoiceInputMode = DEFAULT_VOICE_INPUT_MODE
  let state: HuddleState = defaultState(persistedVoiceInputMode)

  function requireInProgress(message: string): void {
    if (!IN_PROGRESS_PHASES.has(state.phase)) {
      throw new Error(message)
    }
  }

  return {
    getState: () => ({ ...state, participants: [...state.participants], agent_pubkeys: [...state.agent_pubkeys] }),

    start: (input) => {
      if (state.phase !== 'idle') {
        throw new Error(phaseConflictMessage('start', state.phase))
      }
      const ephemeralChannelId = `huddle-${randomUUID()}`
      state = {
        ...defaultState(persistedVoiceInputMode),
        phase: 'creating',
        parent_channel_id: input.parentChannelId,
        ephemeral_channel_id: ephemeralChannelId,
        participants: dedupe([input.callerPubkey, ...input.memberPubkeys]),
        is_creator: true
      }
      return { ephemeral_channel_id: ephemeralChannelId }
    },

    join: (input) => {
      if (state.phase !== 'idle') {
        throw new Error(phaseConflictMessage('join', state.phase))
      }
      state = {
        ...defaultState(persistedVoiceInputMode),
        phase: 'connecting',
        parent_channel_id: input.parentChannelId,
        ephemeral_channel_id: input.ephemeralChannelId,
        participants: dedupe([input.callerPubkey]),
        is_creator: false
      }
      return { ephemeral_channel_id: input.ephemeralChannelId }
    },

    confirmActive: () => {
      requireInProgress('cannot confirm huddle active: no huddle in progress')
      state = { ...state, phase: 'active' }
      return { ...state }
    },

    leave: () => {
      // Idempotent by design — HuddleContext.tsx always calls this on
      // unmount/cleanup even when it isn't sure a huddle is active, and
      // relies on it never throwing for "already idle".
      state = defaultState(persistedVoiceInputMode)
      return { ...state }
    },

    end: () => {
      // Same reset as leave(). Dobius has no remote peers to disrupt by
      // ending "someone else's" huddle, so — unlike a real multi-party
      // backend — there is no creator-only restriction to enforce here.
      state = defaultState(persistedVoiceInputMode)
      return { ...state }
    },

    addAgent: (input) => {
      requireInProgress('cannot add agent: no active huddle')
      const pubkey = input.pubkey.trim()
      if (!pubkey) {
        throw new Error('cannot add agent: missing pubkey')
      }
      state = {
        ...state,
        participants: dedupe([...state.participants, pubkey]),
        agent_pubkeys: dedupe([...state.agent_pubkeys, pubkey])
      }
      return { ...state }
    },

    setVoiceInputMode: (mode) => {
      persistedVoiceInputMode = mode
      state = { ...state, voice_input_mode: mode }
      return { ...state }
    },

    setTranscriptionEnabled: (enabled) => {
      requireInProgress('cannot toggle transcription: no active huddle')
      state = { ...state, transcription_enabled: enabled }
      return { ...state }
    },

    setTtsEnabled: (enabled) => {
      requireInProgress('cannot toggle TTS: no active huddle')
      state = { ...state, tts_enabled: enabled }
      return { ...state }
    },

    reconnectAudio: () => {
      // Dobius has no persistent external audio pipe to actually reconnect
      // (see huddles/README notes in the build report) — this re-affirms
      // the session is still live rather than redialing anything.
      requireInProgress('cannot reconnect audio: no active huddle')
      return { ...state }
    }
  }
}

let singleton: HuddleSessionStore | null = null

/** Process-wide huddle session store used by the RPC methods. */
export function getHuddleSessionStore(): HuddleSessionStore {
  singleton ??= createHuddleSessionStore()
  return singleton
}

/** Test-only reset hook — mirrors the pattern in agent-participant-identity-store.ts. */
export function resetHuddleSessionStoreForTests(): void {
  singleton = null
}
