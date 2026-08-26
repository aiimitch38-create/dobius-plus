/**
 * Verification-harness fixtures for the Communications agent-family RPC
 * methods (agent-provider-config / agent-approvals / agent-observer-index,
 * backed by src/main/communications/agents/*-store.ts via
 * communications-agent-methods.ts). Composed into the shared SCENARIO array
 * by ../verify/command-scenario.ts; this file only exports SCENARIO_STEPS.
 *
 * SEAM — every step sets via: 'method' and dispatches an allowlisted RPC
 * METHOD name ('agentConfig.get', 'agentHarness.save', ...) through the real
 * gateway (sender-trust + COMMUNICATIONS_RUNTIME_METHODS allowlist +
 * dispatcher). The vendored Buzz client reached these features through
 * snake_case Tauri commands whose cases live in vendor/buzz-desktop/src/
 * shared/api/dobiusCommunications.ts; that client is being deleted, so no
 * step here may dispatch a vendor command name anymore.
 *
 * DROPPED AT THIS PORT (no deterministic-PASS method seam exists — see
 * run-verification.test.ts's method-seam install-gate, which has no escape
 * hatch):
 * - build_observer_control_event / decrypt_observer_event: main-process
 *   implementations EXIST and are registered in ALL_RPC_METHODS
 *   (agentObserver.buildControlEvent / agentObserver.decryptEvent in
 *   communications-agent-methods.ts) but are MISSING from
 *   COMMUNICATIONS_RUNTIME_METHODS — the gateway rejects both names before
 *   any handler runs. Port them once the allowlist grows the two names (and
 *   the participant-identity setup gap documented below is closed).
 * - has_managed_agent_channel_message_marker: pure relay-protocol operation
 *   (client-side relay query over kind-9 "#marker" filters); its vendor case
 *   never called into Dobius at all, and no RPC method backs it.
 * - connect_acp_runtime (→ accounts.selectClaude/selectCodex) and
 *   get_model_status (→ speech.models.list): both targets ARE allowlisted,
 *   but their handlers call runtime members (selectClaudeAccount /
 *   selectCodexAccount / listMobileSpeechModels) wired up only during real
 *   Electron startup, which the headless harness stub cannot serve — same
 *   reason workstation.scenarios.ts omits workstationGit.checkPipelineHotstart.
 * - discover_backend_providers, probe_backend_provider,
 *   discover_acp_auth_methods, discover_managed_agent_prereqs,
 *   get_baked_build_env, get_baked_build_env_keys, get_runtime_file_config,
 *   observer_archive_default_enabled, agent_metric_archive_default_enabled:
 *   vendor-switch-only constant stubs whose cases returned hardcoded values
 *   without ever touching the bridge — there is no method behind them, and
 *   deleting the vendored client deletes these behaviors outright.
 *
 * No live CustomAgent is needed by any step below: every ported command
 * operates on global stores keyed by identifiers this file synthesizes, not
 * on managed-agent records (which core owns and tears down before family
 * steps run — see the composer's ORDERING doc).
 *
 * OBSERVER IDENTITY NOTE (kept for the dropped crypto pair): the dropped
 * observer-event methods delegate to the identity slice's NIP-44 code plus
 * participant-identity-store.ts, which reads a real safeStorage-encrypted
 * file under os.homedir() (~/.dobius/communications-identity.enc) that this
 * harness's isolation does not set up. That second blocker stands even after
 * the allowlist gap above is fixed, unless the harness calls
 * ensureParticipantIdentity() somewhere isolated first.
 */
import {
  type ScenarioContext,
  type ScenarioStep,
  isRecord,
  ok,
  fail,
  randomHexPubkey
} from '../scenario-contract'

const CHANNEL_ID_KEY = 'agentsChannelId'

function myChannelId(ctx: ScenarioContext): string {
  const existing = ctx.family[CHANNEL_ID_KEY]
  if (typeof existing === 'string' && existing) {
    return existing
  }
  // A synthetic, run-unique id is a real, valid target: the observer index is
  // keyed by arbitrary channelId strings and never requires a channel-metadata
  // event to exist.
  const generated = `agents-verify-${randomHexPubkey().slice(0, 16)}`
  ctx.family[CHANNEL_ID_KEY] = generated
  return generated
}

// Both observer-index steps derive the event id from the shared channel id so
// the read step can assert the exact row the write step persisted without
// needing a capture across a Date.now() second boundary.
function myIndexedEventId(ctx: ScenarioContext): string {
  return `agents-verify-evt-${myChannelId(ctx)}`
}

export const SCENARIO_STEPS: ScenarioStep[] = [
  // ── agent-observer-index ────────────────────────────────────────────────
  {
    // Writes a real row into the isolated observer-channel-index store
    // (communications-observer-channel-index.json under the harness's scratch
    // userData). The vendor case swallowed the handler result to undefined;
    // the method returns the honest { indexed } count, which proves the entry
    // landed instead of silently no-op'ing.
    command: 'agentObserverIndex.write',
    via: 'method',
    args: (ctx) => ({
      entries: [
        { eventId: myIndexedEventId(ctx), channelId: myChannelId(ctx), createdAt: Math.floor(Date.now() / 1000) }
      ]
    }),
    shapeCheck: (r) =>
      isRecord(r) && r.indexed === 1 ? ok() : fail(`expected { indexed: 1 }, got ${JSON.stringify(r)}`)
  },
  {
    // Reads back what the prior step wrote through the REAL store. (The old
    // vendor case hardcoded [] because full-content hydration waits on a
    // raw-event archive that does not exist yet — but the id→channel index
    // itself is real, so the read can now assert the exact written row.)
    // Reshape note: vendor args were flat { channelId, beforeCreatedAt,
    // beforeId, limit }; the method takes a structured nullable `before`.
    command: 'agentObserverIndex.readForChannel',
    via: 'method',
    args: (ctx) => ({ channelId: myChannelId(ctx), before: null, limit: 10 }),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !Array.isArray(r.entries)) {
        return fail(`expected { entries: [...] }, got ${JSON.stringify(r)}`)
      }
      if (r.entries.length !== 1) {
        return fail(`expected exactly the one indexed row, got ${JSON.stringify(r.entries)}`)
      }
      const entry = r.entries[0]
      return (
        isRecord(entry) &&
        entry.eventId === myIndexedEventId(ctx) &&
        entry.channelId === myChannelId(ctx) &&
        typeof entry.createdAt === 'number' &&
        Number.isFinite(entry.createdAt)
      )
        ? ok()
        : fail(`indexed row did not round-trip as written: ${JSON.stringify(entry)}`)
    }
  },

  // ── agent-approvals ──────────────────────────────────────────────────────
  {
    // No pending decision exists (creating one requires a live agent run
    // against a real model account). Filtering the real in-memory
    // agent-decision queue for an unknown run id and getting an empty list is
    // a genuine, non-vacuous pass through the real approval bridge.
    // Reshape note: the vendor case also accepted workflowId; the method
    // schema takes only runId, and wraps rows in { approvals } with the
    // camelCase fields the bridge produces (no vendor snake_case projection).
    command: 'agentApprovals.listForRun',
    via: 'method',
    args: () => ({ runId: 'agents-verify-run' }),
    shapeCheck: (r) =>
      isRecord(r) && Array.isArray(r.approvals)
        ? ok()
        : fail(`expected { approvals: [...] }, got ${JSON.stringify(r)}`)
  },

  // ── agent-provider-config: global config + preferences ───────────────────
  {
    // Global provider defaults as actually persisted (fresh defaults on
    // first read in the isolated userData dir). The vendor case unwrapped
    // the { config } envelope; the method returns it directly, so the oracle
    // asserts the wrapper plus the four-field config contract.
    command: 'agentConfig.get',
    via: 'method',
    args: () => ({}),
    shapeCheck: (r) => {
      if (!isRecord(r) || !isRecord(r.config)) {
        return fail(`expected { config }, got ${JSON.stringify(r)}`)
      }
      const config = r.config
      return (
        isRecord(config.env_vars) &&
        (config.provider === null || typeof config.provider === 'string') &&
        (config.model === null || typeof config.model === 'string') &&
        (config.preferred_runtime === null || typeof config.preferred_runtime === 'string')
      )
        ? ok()
        : fail(`unexpected get shape: ${JSON.stringify(config)}`)
    }
  },
  {
    // Reshape note: the vendor case wrapped the payload as { config }; the
    // method's zod schema IS the flattened config object. Asserts the sent
    // env var persisted AND the honest restart counts (Dobius agents are
    // on-demand SDK queries — nothing resident to stop and respawn, so both
    // counts are structurally zero, not fabricated activity).
    command: 'agentConfig.set',
    via: 'method',
    args: () => ({
      env_vars: { AGENTS_VERIFY: 'probe' },
      provider: 'anthropic',
      model: null,
      preferred_runtime: 'claude'
    }),
    shapeCheck: (r) => {
      if (!isRecord(r) || !isRecord(r.config) || !isRecord(r.config.env_vars)) {
        return fail(`unexpected set shape: ${JSON.stringify(r)}`)
      }
      return r.config.env_vars.AGENTS_VERIFY === 'probe' && r.restarted_count === 0 && r.failed_restart_count === 0
        ? ok()
        : fail(`config did not persist as sent (or restart counts lied): ${JSON.stringify(r)}`)
    }
  },
  {
    // Reshape note: same { enabled } arg the vendor case forwarded; the
    // method returns the stored boolean instead of undefined.
    command: 'agentManagedProfiles.set',
    via: 'method',
    args: () => ({ enabled: true }),
    shapeCheck: (r) =>
      isRecord(r) && r.enabled === true ? ok() : fail(`expected { enabled: true }, got ${JSON.stringify(r)}`)
  },
  {
    // Reads the flag back through the REAL persisted store (shared
    // communications-global-agent-config.json) — persistence proof, not an
    // echo of the setter's argument. This method had no vendor switch case
    // at all; the gateway seam is the only path it was ever reachable over.
    command: 'agentManagedProfiles.get',
    via: 'method',
    args: () => ({}),
    shapeCheck: (r) =>
      isRecord(r) && r.enabled === true ? ok() : fail(`managed-profiles flag did not persist: ${JSON.stringify(r)}`)
  },

  // ── agent-provider-config: custom harness catalog ────────────────────────
  {
    // Reshape note: same args the vendor case forwarded ({ definition,
    // originalId }). The vendor's Buzz catalog projection (source/
    // binary_path/auth_status decoration) does not exist at this seam — the
    // method returns the raw persisted definition under { harness }, so the
    // oracle asserts the fields the store actually keeps.
    command: 'agentHarness.save',
    via: 'method',
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
    shapeCheck: (r) => {
      if (!isRecord(r) || !isRecord(r.harness)) {
        return fail(`expected { harness }, got ${JSON.stringify(r)}`)
      }
      const harness = r.harness
      return harness.id === 'agents-verify-harness' &&
        harness.label === 'Agents Verify Harness' &&
        harness.command === 'agents-verify-harness-cli'
        ? ok()
        : fail(`harness did not persist as sent: ${JSON.stringify(harness)}`)
    }
  },
  {
    // Cleanup for the save above; the vendor case returned undefined while
    // the method honestly reports what it removed.
    command: 'agentHarness.delete',
    via: 'method',
    args: () => ({ id: 'agents-verify-harness' }),
    shapeCheck: (r) =>
      isRecord(r) && r.removed === true && r.id === 'agents-verify-harness'
        ? ok()
        : fail(`unexpected delete result: ${JSON.stringify(r)}`)
  }
]
