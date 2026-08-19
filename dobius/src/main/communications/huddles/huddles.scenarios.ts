/**
 * Verification-harness fixtures for the voice-huddles command family. See
 * ../verify/command-scenario.ts's top doc comment for the composer contract
 * this file plugs into (SCENARIO_STEPS is imported and spread there — that
 * file is not edited here).
 *
 * ORDERING: this is one continuous, stateful huddle lifecycle run through
 * `invokeDobiusBackedTauriCommand` — the same real dispatch path the app
 * itself uses (see huddle-lifecycle-methods.ts / huddle-preference-methods.ts
 * for what each command actually does). It starts a huddle, exercises every
 * headlessly-testable command against it, leaves, starts a SECOND huddle via
 * join_huddle (to cover the non-creator path), then ends it — so the harness
 * finishes with no huddle session left running, per the brief.
 *
 * OMITTED ON PURPOSE (4 of 17) — real audio, not fakeable headlessly:
 *   - list_audio_output_devices / get_audio_output_device / set_audio_output_device
 *     call `navigator.mediaDevices` directly from the case block (see the
 *     build report's SWITCH_CASES) — that API does not exist in this Node/
 *     vitest harness, only in a real Chromium renderer.
 *   - speak_agent_message shells out to a real OS text-to-speech engine
 *     (`say` / PowerShell / spd-say) that would audibly play through this
 *     machine's speakers if invoked here. huddle-speech-synthesis.test.ts
 *     already covers its logic with an injected fake process runner; running
 *     the real engine from a shared, unattended verification harness is
 *     exactly the "fake/uncontrolled audio pipeline" this task says not to
 *     write. All four are verifiable only by launching the real app — see
 *     the build report's SCENARIOS section.
 */
import { fail, hasStringField, isRecord, ok, randomHexPubkey, type ScenarioStep } from '../scenario-contract'

const PARENT_CHANNEL_ID = 'verify-huddle-parent'
const JOIN_PARENT_CHANNEL_ID = 'verify-huddle-parent-2'
const JOIN_EPHEMERAL_CHANNEL_ID = `verify-huddle-join-${randomHexPubkey().slice(0, 12)}`

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    command: 'start_huddle',
    args: () => ({ parentChannelId: PARENT_CHANNEL_ID, memberPubkeys: [], channelName: 'Verify Huddle' }),
    shapeCheck: (r) =>
      hasStringField(r, 'ephemeral_channel_id') ? ok() : fail(`missing ephemeral_channel_id: ${JSON.stringify(r)}`),
    capture: (r, ctx) => {
      if (isRecord(r) && typeof r.ephemeral_channel_id === 'string') {
        ctx.family.huddleEphemeralChannelId = r.ephemeral_channel_id
      }
    }
  },
  {
    command: 'get_huddle_state',
    args: () => ({}),
    shapeCheck: (r, ctx) =>
      isRecord(r) &&
      r.phase === 'creating' &&
      r.is_creator === true &&
      r.ephemeral_channel_id === ctx.family.huddleEphemeralChannelId
        ? ok()
        : fail(`unexpected state after start: ${JSON.stringify(r)}`)
  },
  {
    command: 'confirm_huddle_active',
    args: () => ({}),
    shapeCheck: (r) => (isRecord(r) && r.phase === 'active' ? ok() : fail(`expected active phase: ${JSON.stringify(r)}`))
  },
  {
    command: 'add_agent_to_huddle',
    // Uses the CORE-seeded otherPubkey rather than ctx.managedAgentPubkey —
    // by the time family steps run, CORE_SCENARIO_STEPS has already deleted
    // its persona (see command-scenario.ts's `delete_persona` step), and
    // add_agent_to_huddle's case block does not require a live agent lookup
    // (it forwards whatever pubkey the caller already resolved) — matching
    // the original Tauri command's contract exactly.
    args: (ctx) => ({ agentPubkey: ctx.otherPubkey }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && r.ephemeral_added === true && typeof r.parent_added === 'boolean'
        ? ok()
        : fail(`unexpected add_agent_to_huddle shape: ${JSON.stringify(r)} (agent ${ctx.otherPubkey})`)
  },
  {
    command: 'get_huddle_agent_pubkeys',
    args: () => ({}),
    shapeCheck: (r, ctx) =>
      Array.isArray(r) && r.includes(ctx.otherPubkey) ? ok() : fail(`agent pubkey missing: ${JSON.stringify(r)}`)
  },
  {
    command: 'set_huddle_transcription_enabled',
    args: () => ({ enabled: false }),
    shapeCheck: (r) =>
      isRecord(r) && r.transcription_enabled === false ? ok() : fail(`transcription flag not set: ${JSON.stringify(r)}`)
  },
  {
    command: 'set_tts_enabled',
    args: () => ({ enabled: false }),
    shapeCheck: (r) => (isRecord(r) && r.tts_enabled === false ? ok() : fail(`tts flag not set: ${JSON.stringify(r)}`))
  },
  {
    command: 'set_voice_input_mode',
    args: () => ({ mode: 'push_to_talk' }),
    shapeCheck: (r) =>
      isRecord(r) && r.voice_input_mode === 'push_to_talk' ? ok() : fail(`mode not set: ${JSON.stringify(r)}`)
  },
  {
    command: 'get_voice_input_mode',
    args: () => ({}),
    shapeCheck: (r) => (r === 'push_to_talk' ? ok() : fail(`unexpected voice input mode: ${JSON.stringify(r)}`))
  },
  {
    command: 'reconnect_huddle_audio',
    args: () => ({}),
    // Real, honest semantics: no live external audio connection exists to
    // redial (see the build report's PIECE THAT'S MISSING), so this
    // re-affirms the in-progress session rather than reconnecting hardware —
    // verified here as "still active", not as "audio restored".
    shapeCheck: (r) => (isRecord(r) && r.phase === 'active' ? ok() : fail(`expected still active: ${JSON.stringify(r)}`))
  },
  {
    command: 'leave_huddle',
    args: () => ({}),
    shapeCheck: (r) => (isRecord(r) && r.phase === 'idle' ? ok() : fail(`expected idle after leave: ${JSON.stringify(r)}`))
  },
  {
    command: 'join_huddle',
    args: () => ({ parentChannelId: JOIN_PARENT_CHANNEL_ID, ephemeralChannelId: JOIN_EPHEMERAL_CHANNEL_ID }),
    shapeCheck: (r) =>
      isRecord(r) && r.ephemeral_channel_id === JOIN_EPHEMERAL_CHANNEL_ID
        ? ok()
        : fail(`unexpected join_huddle shape: ${JSON.stringify(r)}`)
  },
  {
    // Ends the huddle this scenario joined, so the harness finishes with no
    // huddle session left running.
    command: 'end_huddle',
    args: () => ({}),
    shapeCheck: (r) => (isRecord(r) && r.phase === 'idle' ? ok() : fail(`expected idle after end: ${JSON.stringify(r)}`))
  }
]
