/**
 * Verification-harness fixtures for the voice-huddles RPC family
 * (huddle-lifecycle-methods.ts + huddle-preference-methods.ts). Composed into
 * the shared SCENARIO array by ../verify/command-scenario.ts (the harness
 * owner splices this in with one import + one array-spread); this module
 * never edits verify/ itself.
 *
 * SEAM — every step sets via: 'method' and dispatches by RPC METHOD name
 * ('huddle.start', ...) through the real communications gateway pipeline
 * (sender-trust check + COMMUNICATIONS_RUNTIME_METHODS allowlist +
 * dispatcher). All fourteen names below are allowlisted in src/shared/
 * communications-bridge.ts, so a missing-allowlist regression surfaces as a
 * loud gateway ERROR, not a silent skip. The vendored Buzz client reached
 * these same handlers through snake_case Tauri commands whose case blocks in
 * vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts wrapped them;
 * that client is being deleted, so this file asserts the RAW handler wire
 * shapes (huddle-session-store.ts's HuddleState), not the retired wrappers:
 *
 *   - start_huddle/join_huddle case blocks resolved callerPubkey from the
 *     renderer's localStorage identity before calling the method; the method
 *     schema requires it explicitly (requiredString('Missing caller
 *     pubkey')), so these fixtures pass ctx.selfPubkey — the same harness
 *     identity the runner seeds into localStorage, now sent as a plain arg.
 *   - add_agent_to_huddle's case block reshaped agentPubkey -> { pubkey },
 *     then ALSO wrote the parent channel's relay membership (kind-39002 via
 *     addDobiusChannelMembers) and wrapped everything as { ephemeral_added,
 *     parent_added, parent_error }. That parent-channel write is relay-
 *     protocol glue with NO bridge method, and the wrapper existed only in
 *     the case block — the real handler takes { pubkey } and returns the
 *     updated HuddleState, which is what these fixtures assert instead.
 *
 * PORTED OFF THE "OMITTED" LIST: speak_agent_message. The vendor case block
 * called the method with TTS state outside this scenario's control, so the
 * old file omitted it (a live call shells out to the OS speech engine). On
 * the method seam the chain itself sets tts_enabled=false first, and the
 * handler's server-side mute check (huddle-preference-methods.ts) short-
 * circuits BEFORE getHuddleSpeechQueue() ever runs — returning
 * { played: false, reason: 'tts_disabled' } deterministically with zero
 * processes spawned. That mute path is the oracle below.
 *
 * DROPPED (3 of the old 17-command surface, unchanged from the previous
 * omission list): list_audio_output_devices / get_audio_output_device /
 * set_audio_output_device have no bridge method at all — their vendor case
 * blocks call navigator.mediaDevices directly in the renderer (see
 * huddle-preference-methods.ts's doc comment), which does not exist in this
 * Node harness. They are renderer-only operations, not RPC methods, so there
 * is nothing on the method seam to port them to.
 *
 * ORDERING: one continuous, stateful huddle lifecycle — start, exercise
 * every headlessly-testable method against it, leave, join a SECOND huddle
 * (covering the non-creator path), then end it — so the harness finishes
 * with the singleton session store back in its default idle state and no
 * huddle left running, per the brief.
 *
 * NO requiresSecondBoundary anywhere: every method here mutates only the
 * in-memory huddle session store (huddle-session-store.ts) and never writes
 * a relay event, so there is no addressable-event created_at tie-break race
 * for the runner's second-boundary wait to guard.
 */
import { fail, hasStringField, isRecord, ok, randomHexPubkey, type ScenarioStep } from '../scenario-contract'

const PARENT_CHANNEL_ID = 'verify-huddle-parent'
const JOIN_PARENT_CHANNEL_ID = 'verify-huddle-parent-2'
const JOIN_EPHEMERAL_CHANNEL_ID = `verify-huddle-join-${randomHexPubkey().slice(0, 12)}`
const SPEAK_TEXT = 'Verification probe message.'

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    // Flat args plus the explicit callerPubkey the schema demands (the
    // retired vendor case injected it from localStorage identity).
    // channelName is accepted-and-ignored by the store (StartHuddleParams
    // keeps it optional; start() never reads it) — sent anyway to pin that
    // tolerance down rather than let it silently become a validation error.
    command: 'huddle.start',
    via: 'method',
    args: (ctx) => ({
      parentChannelId: PARENT_CHANNEL_ID,
      memberPubkeys: [],
      channelName: 'Verify Huddle',
      callerPubkey: ctx.selfPubkey
    }),
    shapeCheck: (r) =>
      hasStringField(r, 'ephemeral_channel_id') ? ok() : fail(`missing ephemeral_channel_id: ${JSON.stringify(r)}`),
    capture: (r, ctx) => {
      if (isRecord(r) && typeof r.ephemeral_channel_id === 'string') {
        ctx.family.huddleEphemeralChannelId = r.ephemeral_channel_id
      }
    }
  },
  {
    // Full HuddleState readback: creating phase, creator flag, OUR captured
    // ephemeral id, and the caller pubkey landing in participants proves the
    // explicit callerPubkey arg actually reached the store.
    command: 'huddle.getState',
    via: 'method',
    args: () => ({}),
    shapeCheck: (r, ctx) =>
      isRecord(r) &&
      r.phase === 'creating' &&
      r.is_creator === true &&
      r.ephemeral_channel_id === ctx.family.huddleEphemeralChannelId &&
      Array.isArray(r.participants) &&
      r.participants.includes(ctx.selfPubkey)
        ? ok()
        : fail(`unexpected state after start: ${JSON.stringify(r)}`)
  },
  {
    command: 'huddle.confirmActive',
    via: 'method',
    args: () => ({}),
    shapeCheck: (r) => (isRecord(r) && r.phase === 'active' ? ok() : fail(`expected active phase: ${JSON.stringify(r)}`))
  },
  {
    // Uses the CORE-seeded otherPubkey rather than ctx.managedAgentPubkey —
    // by the time family steps run, CORE_SCENARIO_STEPS has already deleted
    // its persona, and the handler does not require a live agent lookup
    // (it trims and forwards whatever pubkey the caller already resolved).
    // Raw result is the updated HuddleState — the retired vendor wrapper
    // ({ ephemeral_added, parent_added, parent_error }) lived only in the
    // deleted case block, alongside its relay-protocol parent-channel write
    // that has no bridge method to port to.
    command: 'huddle.addAgent',
    via: 'method',
    args: (ctx) => ({ pubkey: ctx.otherPubkey }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && Array.isArray(r.agent_pubkeys) && r.agent_pubkeys.includes(ctx.otherPubkey)
        ? ok()
        : fail(`agent pubkey missing from returned state: ${JSON.stringify(r)} (agent ${ctx.otherPubkey})`)
  },
  {
    command: 'huddle.getAgentPubkeys',
    via: 'method',
    args: () => ({}),
    shapeCheck: (r, ctx) =>
      Array.isArray(r) && r.includes(ctx.otherPubkey) ? ok() : fail(`agent pubkey missing: ${JSON.stringify(r)}`)
  },
  {
    command: 'huddle.setTranscriptionEnabled',
    via: 'method',
    args: () => ({ enabled: false }),
    shapeCheck: (r) =>
      isRecord(r) && r.transcription_enabled === false ? ok() : fail(`transcription flag not set: ${JSON.stringify(r)}`)
  },
  {
    command: 'huddle.setTtsEnabled',
    via: 'method',
    args: () => ({ enabled: false }),
    shapeCheck: (r) => (isRecord(r) && r.tts_enabled === false ? ok() : fail(`tts flag not set: ${JSON.stringify(r)}`))
  },
  {
    // Deterministic BECAUSE of the toggle above: the handler's server-side
    // mute check rejects before the speech queue runs, so no OS synthesizer
    // process is ever spawned headlessly (see module doc, PORTED OFF THE
    // "OMITTED" LIST).
    command: 'huddle.speak',
    via: 'method',
    args: () => ({ text: SPEAK_TEXT }),
    shapeCheck: (r) =>
      isRecord(r) && r.played === false && r.reason === 'tts_disabled'
        ? ok()
        : fail(`expected muted speak outcome, got: ${JSON.stringify(r)}`)
  },
  {
    command: 'huddle.setVoiceInputMode',
    via: 'method',
    args: () => ({ mode: 'push_to_talk' }),
    shapeCheck: (r) =>
      isRecord(r) && r.voice_input_mode === 'push_to_talk' ? ok() : fail(`mode not set: ${JSON.stringify(r)}`)
  },
  {
    command: 'huddle.getVoiceInputMode',
    via: 'method',
    args: () => ({}),
    shapeCheck: (r) => (r === 'push_to_talk' ? ok() : fail(`unexpected voice input mode: ${JSON.stringify(r)}`))
  },
  {
    command: 'huddle.reconnectAudio',
    via: 'method',
    args: () => ({}),
    // Real, honest semantics: Dobius has no persistent external audio pipe
    // to redial (huddle-session-store.ts reconnectAudio) — the handler
    // re-affirms the in-progress session, verified here as "still active",
    // not as "hardware audio restored". No device enumeration happens.
    shapeCheck: (r) => (isRecord(r) && r.phase === 'active' ? ok() : fail(`expected still active: ${JSON.stringify(r)}`))
  },
  {
    command: 'huddle.leave',
    via: 'method',
    args: () => ({}),
    shapeCheck: (r) => (isRecord(r) && r.phase === 'idle' ? ok() : fail(`expected idle after leave: ${JSON.stringify(r)}`))
  },
  {
    // Non-creator path: is_creator stays false and the phase is connecting,
    // distinguishing join from the creator's start above.
    command: 'huddle.join',
    via: 'method',
    args: (ctx) => ({
      parentChannelId: JOIN_PARENT_CHANNEL_ID,
      ephemeralChannelId: JOIN_EPHEMERAL_CHANNEL_ID,
      callerPubkey: ctx.selfPubkey
    }),
    shapeCheck: (r) =>
      isRecord(r) && r.ephemeral_channel_id === JOIN_EPHEMERAL_CHANNEL_ID
        ? ok()
        : fail(`unexpected join result: ${JSON.stringify(r)}`)
  },
  {
    // Ends the huddle this scenario joined, so the harness finishes with no
    // huddle session left running.
    command: 'huddle.end',
    via: 'method',
    args: () => ({}),
    shapeCheck: (r) => (isRecord(r) && r.phase === 'idle' ? ok() : fail(`expected idle after end: ${JSON.stringify(r)}`))
  }
]
