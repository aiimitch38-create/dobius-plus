/**
 * CORE scenario steps, part 1 — identity, relay lifecycle, persona/managed
 * agent lifecycle. Part 2 (channels/messages/DM) lives in
 * core-channels.scenarios.ts; this file concatenates both into
 * CORE_SETUP_STEPS and re-exports CORE_TEARDOWN_STEPS from
 * core-teardown.scenarios.ts.
 *
 * SEAM — this family establishes the verification gate's world with ZERO
 * vendor imports:
 *   - `via: 'method'` steps dispatch allowlisted RPC METHOD names through the
 *     real gateway pipeline (see run-verification.test.ts's methodEntries).
 *   - Every other step carries a `direct` helper from ./relay-world-ops.ts,
 *     which the runner invokes in-process — see that module's header for the
 *     exact runner contract and the identity split it documents.
 *
 * IDENTITY SPLIT: ctx.selfPubkey/otherPubkey are still seeded by the runner,
 * but every relay event in this world is now signed by the MAIN-PROCESS
 * participant identity, captured into ctx.family.participantPubkey by the
 * get_identity step. Authorship oracles below assert against that captured
 * pubkey; downstream families asserting authorship against ctx.selfPubkey
 * must reconcile against it too.
 *
 * SETUP establishes a live persona/managed agent/channel/message/DM;
 * TEARDOWN deletes them; every other family's steps splice in between (see
 * the ORDERING doc in command-scenario.ts for why).
 */
import {
  fail,
  hasStringField,
  isRecord,
  ok,
  expectUndefined,
  expectArray,
  type ScenarioContext,
  type ShapeOutcome
} from '../scenario-contract'
import { CORE_CHANNEL_STEPS } from './core-channels.scenarios'
import {
  PARTICIPANT_PUBKEY_KEY,
  RELAY_HTTP_URL,
  RELAY_WS_URL,
  agentModelCatalog,
  applyWorkspace,
  createAuthEvent,
  createManagedAgentFromPersona,
  createPersonaRecord,
  discoverAcpProvidersViaAccountsList,
  emptyManagedAgentRuntimes,
  getRelayHttpUrl,
  getRelayWsUrl,
  isSharedIdentity,
  managedAgentsWorldSnapshot,
  participantIdentity,
  setPreventSleepActive,
  signProbeEvent,
  startManagedAgentWorld,
  stopManagedAgentWorld,
  validateReposDir,
  type DirectScenarioStep
} from './relay-world-ops'

export { CORE_TEARDOWN_STEPS } from './core-teardown.scenarios'

function parsedJsonObject(value: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  if (typeof value !== 'string') {
    return { ok: false, reason: 'expected a JSON string' }
  }
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, reason: 'parsed JSON was not an object' }
  } catch {
    return { ok: false, reason: 'result was not valid JSON' }
  }
}

function expectHex64Field(record: Record<string, unknown>, field: string): ShapeOutcome {
  const value = record[field]
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
    ? ok()
    : fail(`${field} should be 64-hex, got ${JSON.stringify(value)}`)
}

/** True when the runner-seeded context carries the world signer's pubkey. */
export function participantPubkeyOf(ctx: ScenarioContext): string | undefined {
  const value = ctx.family[PARTICIPANT_PUBKEY_KEY]
  return typeof value === 'string' ? value : undefined
}

/**
 * The world-establishing steps. Order matters: identity first (the
 * participant pubkey capture feeds every later authorship oracle), then the
 * persona/agent block, then channels (core-channels.scenarios.ts).
 */
export const CORE_SETUP_STEPS: DirectScenarioStep[] = [
  {
    // Pins the relay HTTP origin the whole gate talks to (derived from the
    // real bind address, not a hardcoded literal).
    command: 'get_relay_http_url',
    direct: getRelayHttpUrl,
    args: () => ({}),
    shapeCheck: (r) => (r === RELAY_HTTP_URL ? ok() : fail(`unexpected relay http url: ${r}`))
  },
  {
    command: 'get_relay_ws_url',
    direct: getRelayWsUrl,
    args: () => ({}),
    shapeCheck: (r) => (r === RELAY_WS_URL ? ok() : fail(`unexpected relay ws url: ${r}`))
  },
  {
    command: 'apply_workspace',
    direct: applyWorkspace,
    args: () => ({ relayUrl: RELAY_WS_URL }),
    shapeCheck: expectUndefined
  },
  {
    command: 'is_shared_identity',
    direct: isSharedIdentity,
    args: () => ({}),
    shapeCheck: (r) => (r === false ? ok() : fail(`expected false, got ${JSON.stringify(r)}`))
  },
  {
    // Exposes the ACTUAL world signer: the main-process participant identity.
    // Its pubkey is captured for every downstream authorship oracle (see
    // IDENTITY SPLIT above) — deliberately NOT ctx.selfPubkey anymore.
    command: 'get_identity',
    direct: async () => participantIdentity(),
    args: () => ({}),
    shapeCheck: (r) =>
      hasStringField(r, 'pubkey') && hasStringField(r, 'display_name')
        ? ok()
        : fail(`missing pubkey/display_name: ${JSON.stringify(r)}`),
    capture: (r, ctx) => {
      if (isRecord(r) && typeof r.pubkey === 'string') {
        ctx.family[PARTICIPANT_PUBKEY_KEY] = r.pubkey
      }
    }
  },
  {
    // Signs with the main-process participant key (the vendored localStorage
    // signer is gone); the wire shape of the result is unchanged.
    command: 'sign_event',
    direct: signProbeEvent,
    args: () => ({ kind: 1, content: 'verification probe', tags: [] }),
    shapeCheck: (r) => {
      const parsed = parsedJsonObject(r)
      if (!parsed.ok) {
        return fail(parsed.reason)
      }
      return hasStringField(parsed.value, 'sig') && hasStringField(parsed.value, 'id')
        ? ok()
        : fail('signed event missing sig/id')
    }
  },
  {
    command: 'create_auth_event',
    direct: createAuthEvent,
    args: () => ({ relayUrl: 'wss://example.invalid', challenge: 'verify-challenge' }),
    shapeCheck: (r) => {
      const parsed = parsedJsonObject(r)
      if (!parsed.ok) {
        return fail(parsed.reason)
      }
      return parsed.value.kind === 22242 && hasStringField(parsed.value, 'sig')
        ? ok()
        : fail('expected kind 22242 signed auth event')
    }
  },
  {
    command: 'validate_repos_dir',
    direct: validateReposDir,
    args: () => ({}),
    shapeCheck: expectUndefined
  },
  {
    command: 'set_prevent_sleep_active',
    direct: setPreventSleepActive,
    args: () => ({ active: true }),
    shapeCheck: expectUndefined
  },
  {
    command: 'discover_agent_models',
    direct: async () => agentModelCatalog(),
    args: () => ({}),
    shapeCheck: (r) => (isRecord(r) && Array.isArray(r.models) ? ok() : fail('missing models array'))
  },
  {
    // Ported from the vendor case that forwarded to team.list over the
    // runtime bridge; now dispatched through the REAL gateway allowlist.
    command: 'team.list',
    via: 'method',
    args: () => ({}),
    shapeCheck: (r) =>
      isRecord(r) && Array.isArray(r.teams)
        ? ok()
        : fail(`expected { teams: [...] }, got ${JSON.stringify(r)}`)
  },
  {
    // Dobius runs agents through its own run lifecycle rather than persistent
    // buzz-acp child processes, so the honest projection is still [] — the
    // structural fact survived the vendor's deletion.
    command: 'reconcile_managed_agent_runtimes',
    direct: emptyManagedAgentRuntimes,
    args: () => ({}),
    shapeCheck: expectArray
  },
  {
    command: 'list_managed_agent_runtimes',
    direct: emptyManagedAgentRuntimes,
    args: () => ({}),
    shapeCheck: expectArray
  },
  {
    // Ported from loadDobiusPersonas → agent.list; the method returns the
    // raw roster envelope instead of the vendor's snake_case projection.
    command: 'agent.list',
    via: 'method',
    args: () => ({}),
    shapeCheck: (r) =>
      isRecord(r) && Array.isArray(r.agents)
        ? ok()
        : fail(`expected { agents: [...] }, got ${JSON.stringify(r)}`)
  },
  {
    // NOT via:'method': snapshots.scenarios.ts already claims 'agent.create'
    // on the method seam and the runner requires unique method-seam command
    // names across SCENARIO. Creates through the same production store layer
    // the RPC handler uses instead (snapshots' documented precedent for this
    // exact constraint).
    command: 'create_persona',
    direct: createPersonaRecord,
    args: () => ({
      input: { displayName: 'Verify Persona', systemPrompt: 'verification probe', model: 'claude' }
    }),
    shapeCheck: (r) => {
      if (!isRecord(r) || !isRecord(r.agent)) {
        return fail(`unexpected persona shape: ${JSON.stringify(r)}`)
      }
      const persisted =
        r.agent.name === 'Verify Persona' &&
        r.agent.systemPrompt === 'verification probe' &&
        r.agent.model === 'claude'
      return persisted && typeof r.agent.id === 'string'
        ? ok()
        : fail(`persona did not persist as created: ${JSON.stringify(r.agent)}`)
    },
    capture: (r, ctx) => {
      if (isRecord(r) && isRecord(r.agent) && typeof r.agent.id === 'string') {
        ctx.personaId = r.agent.id
      }
    }
  },
  {
    command: 'agent.update',
    via: 'method',
    args: (ctx) => ({ id: ctx.personaId, updates: { name: 'Verify Persona Updated' } }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && isRecord(r.agent) && r.agent.id === ctx.personaId && r.agent.name === 'Verify Persona Updated'
        ? ok()
        : fail(`persona name was not updated: ${JSON.stringify(r)}`)
  },
  {
    // Projects the live roster + run state through the main-process agent
    // identity registry — the managed agent's REAL signing pubkey, which no
    // RPC method exposes (the vendored one came from renderer localStorage).
    command: 'list_managed_agents',
    direct: managedAgentsWorldSnapshot,
    args: () => ({}),
    shapeCheck: (r, ctx) => {
      if (!Array.isArray(r)) {
        return fail('expected an array')
      }
      const mine = r.find((agent) => isRecord(agent) && agent.backend_agent_id === ctx.personaId)
      if (!isRecord(mine)) {
        return fail('created persona did not appear in list_managed_agents')
      }
      const hex = expectHex64Field(mine, 'pubkey')
      return hex.ok ? ok() : fail(`managed agent ${hex.reason}`)
    },
    capture: (r, ctx) => {
      if (!Array.isArray(r)) {
        return
      }
      const mine = r.find((agent) => isRecord(agent) && agent.backend_agent_id === ctx.personaId)
      if (isRecord(mine) && typeof mine.pubkey === 'string') {
        ctx.managedAgentPubkey = mine.pubkey
      }
    }
  },
  {
    command: 'create_managed_agent',
    direct: createManagedAgentFromPersona,
    args: (ctx) => ({ input: { personaId: ctx.personaId } }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && isRecord(r.agent) && r.agent.backend_agent_id === ctx.personaId
        ? ok()
        : fail(`unexpected create_managed_agent shape: ${JSON.stringify(r)}`)
  },
  {
    // Readiness projections, not process supervision (Dobius agents are
    // on-demand workers) — same semantics as the vendored projection.
    command: 'start_managed_agent',
    direct: startManagedAgentWorld,
    args: (ctx) => ({ pubkey: ctx.managedAgentPubkey }),
    shapeCheck: (r) => (isRecord(r) && r.status === 'running' ? ok() : fail(`not running: ${JSON.stringify(r)}`))
  },
  {
    command: 'stop_managed_agent',
    direct: stopManagedAgentWorld,
    args: (ctx) => ({ pubkey: ctx.managedAgentPubkey }),
    shapeCheck: (r) => (isRecord(r) && r.status === 'stopped' ? ok() : fail(`not stopped: ${JSON.stringify(r)}`))
  },
  {
    // Direct step whose helper attempts accounts.list through the REAL
    // gateway pipeline; headless it fails on the genuine unconfigured
    // account-services error — expectedError pins that exact rejection (the
    // only sanctioned pairing with a trivial shapeCheck). If it ever stops
    // throwing, account services are wired and the catalog oracle applies.
    command: 'discover_acp_providers',
    direct: discoverAcpProvidersViaAccountsList,
    args: () => ({}),
    shapeCheck: () => ok(),
    expectedError: (message) =>
      message.includes('refreshAccountsForMobile') || message.includes('account services')
  },
  ...CORE_CHANNEL_STEPS
]

