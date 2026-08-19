/**
 * Verification-harness fixtures for the agent-lifecycle / agent-provider-
 * config / agent-approvals command family. Composed into the shared
 * SCENARIO array by ../verify/command-scenario.ts (owned by the verify
 * team — see FAMILY IMPORTS there). This file only exports SCENARIO_STEPS;
 * it does not run anything on its own.
 *
 * COVERAGE NOTE (read before adding a step here): CORE_SCENARIO_STEPS in
 * command-scenario.ts creates its own persona (`create_persona`) and managed
 * agent (`create_managed_agent`), exercises them, then deletes the persona
 * (`delete_persona`, which deletes the same underlying CustomAgent the
 * managed-agent projection points to) — all BEFORE any family's steps run
 * (family arrays are appended wholesale after the whole of
 * CORE_SCENARIO_STEPS; there is no interleaving). `create_persona` and
 * `create_managed_agent` are themselves core-owned scenario steps already
 * covering already-implemented commands, not part of this slice — and the
 * harness's own "every manifest command was verified exactly once" check
 * means no family may add a second step for either command name to mint a
 * fresh, still-alive agent for its own steps to use.
 *
 * Net effect: by the time this file's steps run, there is no live
 * CustomAgent to reference. Commands whose real implementation requires one
 * (resolves a pubkey/id to an existing agent via `managedAgentByPubkey` /
 * `agent.show`) cannot be given a fixture here that both (a) actually
 * exercises the real code path and (b) reliably PASSes — see PER_COMMAND in
 * the handoff report for the exact list and the composer-level fix this
 * needs (splitting CORE_SCENARIO_STEPS into a setup half and a teardown
 * half with family steps spliced between, so a live agent survives into
 * family territory). Those commands are deliberately left out of
 * SCENARIO_STEPS below rather than given a fixture that either fakes success
 * or reliably ERRORs on a resolvable-agent lookup that was never given a
 * chance to resolve.
 *
 * OBSERVER CRYPTO NOTE: `build_observer_control_event` / `decrypt_observer_event`
 * now run in the MAIN PROCESS (observer-event-crypto.ts), delegating to the
 * identity slice's one NIP-44 implementation
 * (`../identity/nip44.ts`'s `nip44EncryptToPeer`/`nip44DecryptFromPeer`) and
 * to `../participant-identity-store.ts`'s `signParticipantEvent` — NOT the
 * renderer's old `dobiusCommunications.ts` identity. That store reads a
 * real, on-disk, safeStorage-encrypted identity file under `os.homedir()`
 * (`~/.dobius/communications-identity.enc`), which this harness's isolation
 * (`runtime-bridge-harness.ts` only mocks `electron.app.getPath('userData')`,
 * not `os.homedir()`) does not set up or isolate. These two steps therefore
 * throw a real, honest "Communications participant identity is not
 * configured" error in this harness today — a setup gap, not a product bug
 * — until either the harness calls `ensureParticipantIdentity()` somewhere
 * isolated, or the machine running it already has one. This file
 * deliberately does NOT call `ensureParticipantIdentity()` itself: doing so
 * from an unisolated test would create/read a REAL file at
 * `~/.dobius/communications-identity.enc` on whatever machine runs the
 * suite — exactly the uncontrolled production side effect
 * `runtime-bridge-harness.ts`'s own doc comment warns against for
 * `agents-store.ts`. See SCENARIOS in the handoff report.
 */
import {
  type ScenarioContext,
  type ScenarioStep,
  isRecord,
  hasStringField,
  ok,
  fail,
  expectUndefined,
  expectArray,
  randomHexPubkey
} from '../scenario-contract'

const OBSERVER_EVENT_KEY = 'agentsObserverControlEventJson'
const CHANNEL_ID_KEY = 'agentsChannelId'

function myChannelId(ctx: ScenarioContext): string {
  const existing = ctx.family[CHANNEL_ID_KEY]
  if (typeof existing === 'string' && existing) {
    return existing
  }
  // Why not `create_channel`: that command is already a core scenario step
  // (and may only appear once — see this file's module doc). This family's
  // channel-scoped commands (the observer index, the marker query) operate
  // on an arbitrary `channelId` string against the local index/relay query
  // layer — they never require a channel-metadata event to exist — so a
  // synthetic, run-unique id is a real, valid target rather than a shortcut.
  const generated = `agents-verify-${randomHexPubkey().slice(0, 16)}`
  ctx.family[CHANNEL_ID_KEY] = generated
  return generated
}

const OBSERVER_PAYLOAD = { type: 'verify_probe', nonce: 'agents-scenario-observer' }

export const SCENARIO_STEPS: ScenarioStep[] = [
  // ── OBSERVER (highest priority — agent liveness depends on these two) ──
  {
    command: 'build_observer_control_event',
    // Addressed to ctx.otherPubkey (an arbitrary synthetic peer — no relation
    // to any real identity; see this file's module doc for why this can no
    // longer be a guaranteed self-round-trip the way a renderer-side
    // implementation could). Asserts the event is really encrypted (not a
    // plaintext passthrough) and correctly shaped/signed regardless of
    // whether the underlying identity is configured in this environment —
    // if it is not, this step throws a real, honest, harness-documented
    // error (see module doc) rather than a fabricated PASS.
    args: (ctx) => ({ agentPubkey: ctx.otherPubkey, payload: OBSERVER_PAYLOAD }),
    shapeCheck: (r, ctx) => {
      if (typeof r !== 'string') {
        return fail('expected a JSON string')
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(r)
      } catch {
        return fail('result was not valid JSON')
      }
      if (!isRecord(parsed)) {
        return fail('parsed event was not an object')
      }
      if (parsed.kind !== 24200) {
        return fail(`expected kind 24200, got ${JSON.stringify(parsed.kind)}`)
      }
      if (!hasStringField(parsed, 'content')) {
        return fail('missing content')
      }
      if (parsed.content === JSON.stringify(OBSERVER_PAYLOAD)) {
        return fail('content was not encrypted — matches the plaintext payload verbatim')
      }
      const tags = parsed.tags
      const addressedToAgent =
        Array.isArray(tags) &&
        tags.some((tag) => Array.isArray(tag) && tag[0] === 'p' && tag[1] === ctx.otherPubkey)
      if (!addressedToAgent) {
        return fail('missing ["p", agentPubkey] tag')
      }
      return hasStringField(parsed, 'sig') && hasStringField(parsed, 'id') ? ok() : fail('missing sig/id')
    },
    capture: (r, ctx) => {
      if (typeof r === 'string') {
        ctx.family[OBSERVER_EVENT_KEY] = r
      }
    }
  },
  {
    // Decrypts what the prior step built, addressed FROM our own identity's
    // real signed pubkey (event.pubkey) back TO us — a genuine round trip
    // through the real main-process crypto when the participant identity is
    // configured (see build_observer_control_event's comment for the
    // "otherwise" case). `ctx.family[OBSERVER_EVENT_KEY]` is `undefined` if
    // the prior step threw (capture only runs after a PASS), which the
    // schema on `agentObserver.decryptEvent` rejects as a validation error —
    // never a crash of this `args()` function.
    command: 'decrypt_observer_event',
    args: (ctx) => ({ eventJson: ctx.family[OBSERVER_EVENT_KEY] }),
    shapeCheck: (r) =>
      isRecord(r) && r.type === OBSERVER_PAYLOAD.type && r.nonce === OBSERVER_PAYLOAD.nonce
        ? ok()
        : fail(`decrypted payload did not round-trip: ${JSON.stringify(r)}`)
  },
  {
    command: 'index_observer_channel_id',
    args: (ctx) => ({
      entries: [
        { eventId: `agents-verify-evt-${myChannelId(ctx)}`, channelId: myChannelId(ctx), createdAt: Math.floor(Date.now() / 1000) }
      ]
    }),
    shapeCheck: expectUndefined
  },
  {
    command: 'read_archived_observer_events_for_channel',
    args: (ctx) => ({ channelId: myChannelId(ctx), beforeCreatedAt: null, beforeId: null, limit: 10 }),
    // Real, honest current behavior (see OBSERVER in the handoff report):
    // the index write above is real, but hydrating a full event body needs
    // a raw-event archive that is a different, not-yet-built feature, so
    // this intentionally still returns an empty array today — a real query
    // against a real (empty) store, not a hardcoded stub.
    shapeCheck: expectArray
  },
  {
    // Negative-path only: sending a marked message requires an existing
    // managed agent (see this file's module doc) — this checks the real
    // relay-query path correctly reports "not found" for a marker nothing
    // has sent yet, which is itself a genuine, non-vacuous assertion.
    command: 'has_managed_agent_channel_message_marker',
    args: (ctx) => ({ channelId: myChannelId(ctx), marker: 'agents-verify-marker', agentPubkey: ctx.otherPubkey }),
    shapeCheck: (r) => (r === false ? ok() : fail(`expected false for an unsent marker, got ${JSON.stringify(r)}`))
  },

  // ── agent-approvals ──────────────────────────────────────────────────
  {
    // No pending decision exists (creating one requires a live agent run
    // against a real model account — out of scope, see the report's
    // SCENARIOS section for what grant_approval/deny_approval could not
    // cover for the same reason). An empty list for an unknown run id is
    // still a real, non-throwing pass through the real decision-queue
    // bridge, not a stub.
    command: 'get_run_approvals',
    args: () => ({ workflowId: 'agents-verify-workflow', runId: 'agents-verify-run' }),
    shapeCheck: expectArray
  },

  // ── agent-provider-config: global config + preferences ─────────────────
  {
    command: 'get_global_agent_config',
    args: () => ({}),
    shapeCheck: (r) =>
      isRecord(r) && 'env_vars' in r && 'provider' in r && 'model' in r && 'preferred_runtime' in r
        ? ok()
        : fail(`unexpected get_global_agent_config shape: ${JSON.stringify(r)}`)
  },
  {
    command: 'set_global_agent_config',
    args: () => ({
      config: { env_vars: { AGENTS_VERIFY: 'probe' }, provider: 'anthropic', model: null, preferred_runtime: 'claude' }
    }),
    shapeCheck: (r) => {
      if (!isRecord(r) || !isRecord(r.config) || !isRecord(r.config.env_vars)) {
        return fail(`unexpected set_global_agent_config shape: ${JSON.stringify(r)}`)
      }
      return r.config.env_vars.AGENTS_VERIFY === 'probe' && typeof r.restarted_count === 'number'
        ? ok()
        : fail(`config did not persist as sent: ${JSON.stringify(r)}`)
    }
  },
  {
    command: 'set_agent_managed_profiles',
    args: () => ({ enabled: true }),
    shapeCheck: expectUndefined
  },

  // ── agent-provider-config: custom harness catalog ───────────────────────
  {
    command: 'save_custom_harness',
    args: () => ({
      definition: {
        id: 'agents-verify-harness',
        label: 'Agents Verify Harness',
        command: 'agents-verify-harness-cli',
        args: [],
        env: {},
        installInstructionsUrl: '',
        installHint: ''
      },
      originalId: null
    }),
    shapeCheck: (r) =>
      isRecord(r) && r.id === 'agents-verify-harness' && r.source === 'custom'
        ? ok()
        : fail(`unexpected save_custom_harness shape: ${JSON.stringify(r)}`)
  },
  {
    command: 'delete_custom_harness',
    args: () => ({ id: 'agents-verify-harness' }),
    shapeCheck: expectUndefined
  },

  // ── agent-provider-config: provider/model discovery ─────────────────────
  {
    command: 'discover_backend_providers',
    args: () => ({}),
    shapeCheck: (r) => (Array.isArray(r) && r.length === 0 ? ok() : fail(`expected an empty array, got ${JSON.stringify(r)}`))
  },
  {
    command: 'probe_backend_provider',
    args: () => ({ binaryPath: '/nonexistent/agents-verify-provider' }),
    shapeCheck: (r) => (isRecord(r) && r.ok === false ? ok() : fail(`expected ok:false, got ${JSON.stringify(r)}`))
  },
  {
    command: 'discover_acp_auth_methods',
    args: () => ({ runtimeId: 'dobius-native:claude:active' }),
    shapeCheck: (r) => (isRecord(r) && Array.isArray(r.methods) ? ok() : fail('missing methods array'))
  },
  {
    command: 'connect_acp_runtime',
    args: () => ({ request: { runtimeId: 'dobius-native:claude:active', methodId: '' } }),
    shapeCheck: (r) => (isRecord(r) && r.launched === true ? ok() : fail(`unexpected connect_acp_runtime shape: ${JSON.stringify(r)}`))
  },
  {
    command: 'discover_managed_agent_prereqs',
    args: () => ({ input: { acpCommand: 'claude', mcpCommand: '' } }),
    shapeCheck: (r) =>
      isRecord(r) && isRecord(r.acp) && r.acp.available === true && isRecord(r.mcp) && r.mcp.available === true
        ? ok()
        : fail(`unexpected discover_managed_agent_prereqs shape: ${JSON.stringify(r)}`)
  },
  {
    command: 'get_model_status',
    args: () => ({}),
    shapeCheck: (r) => (isRecord(r) && 'stt' in r && r.tts === 'unavailable' ? ok() : fail(`unexpected get_model_status shape: ${JSON.stringify(r)}`))
  },
  {
    command: 'get_baked_build_env',
    args: () => ({}),
    shapeCheck: (r) => (Array.isArray(r) && r.length === 0 ? ok() : fail(`expected an empty array, got ${JSON.stringify(r)}`))
  },
  {
    command: 'get_baked_build_env_keys',
    args: () => ({}),
    shapeCheck: (r) => (Array.isArray(r) && r.length === 0 ? ok() : fail(`expected an empty array, got ${JSON.stringify(r)}`))
  },
  {
    command: 'get_runtime_file_config',
    args: () => ({ runtimeId: 'dobius-native:claude:active' }),
    shapeCheck: (r) => (r === null ? ok() : fail(`expected null, got ${JSON.stringify(r)}`))
  },
  {
    command: 'observer_archive_default_enabled',
    args: () => ({}),
    shapeCheck: (r) => (r === false ? ok() : fail(`expected false, got ${JSON.stringify(r)}`))
  },
  {
    command: 'agent_metric_archive_default_enabled',
    args: () => ({}),
    shapeCheck: (r) => (r === false ? ok() : fail(`expected false, got ${JSON.stringify(r)}`))
  }
]
