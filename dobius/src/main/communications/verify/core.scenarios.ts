/**
 * CORE scenario steps — the commands the harness's first version hand-built
 * fixtures for (identity, relay lifecycle, channels, messages, agent
 * lifecycle, teams-snapshots).
 *
 * Split out of command-scenario.ts for the same reason every
 * `<family>.scenarios.ts` exists: that file is the composer, and ~350 lines
 * of inline step definitions pushed it past the repo's max-lines limit.
 * Core is simply the first family. Contents are verbatim — step order,
 * args, oracles and captures unchanged.
 *
 * SETUP establishes a live persona/managed agent/channel/message/DM;
 * TEARDOWN deletes them; every other family's steps splice in between (see
 * the ORDERING doc in command-scenario.ts for why).
 */
import {
  ok,
  fail,
  isRecord,
  hasStringField,
  expectUndefined,
  expectArray,
  type ScenarioStep
} from '../scenario-contract'
import { CORE_CHANNEL_STEPS } from './core-channels.scenarios'

/**
 * The 54 commands this harness's first version hand-built fixtures for.
 * Each step's `args` receives the context accumulated by every earlier
 * step's `capture` — core steps run first (see ORDERING below), so a
 * family module can rely on `ctx.channelId`/`ctx.personaId`/etc. being
 * populated if it needs an existing channel/persona/agent to test against.
 */
export const CORE_SETUP_STEPS: ScenarioStep[] = [
  {
    command: 'get_relay_http_url',
    args: () => ({}),
    shapeCheck: (r) => (r === 'http://localhost:3300' ? ok() : fail(`unexpected relay http url: ${r}`))
  },
  {
    command: 'get_relay_ws_url',
    args: () => ({}),
    shapeCheck: (r) => (r === 'ws://localhost:3300' ? ok() : fail(`unexpected relay ws url: ${r}`))
  },
  {
    command: 'apply_workspace',
    args: () => ({ relayUrl: 'ws://localhost:3300' }),
    shapeCheck: expectUndefined
  },
  {
    command: 'is_shared_identity',
    args: () => ({}),
    shapeCheck: (r) => (r === false ? ok() : fail(`expected false, got ${JSON.stringify(r)}`))
  },
  {
    command: 'get_identity',
    args: () => ({}),
    shapeCheck: (r) =>
      hasStringField(r, 'pubkey') && hasStringField(r, 'display_name')
        ? ok()
        : fail(`missing pubkey/display_name: ${JSON.stringify(r)}`)
  },
  {
    command: 'sign_event',
    args: () => ({ kind: 1, content: 'verification probe', tags: [] }),
    shapeCheck: (r) => {
      if (typeof r !== 'string') {return fail('expected a JSON string')}
      try {
        const parsed = JSON.parse(r)
        return hasStringField(parsed, 'sig') && hasStringField(parsed, 'id')
          ? ok()
          : fail('signed event missing sig/id')
      } catch {
        return fail('result was not valid JSON')
      }
    }
  },
  {
    command: 'create_auth_event',
    args: () => ({ relayUrl: 'wss://example.invalid', challenge: 'verify-challenge' }),
    shapeCheck: (r) => {
      if (typeof r !== 'string') {return fail('expected a JSON string')}
      try {
        const parsed = JSON.parse(r)
        return isRecord(parsed) && parsed.kind === 22242 ? ok() : fail('expected kind 22242 auth event')
      } catch {
        return fail('result was not valid JSON')
      }
    }
  },
  { command: 'validate_repos_dir', args: () => ({}), shapeCheck: expectUndefined },
  { command: 'set_prevent_sleep_active', args: () => ({ active: true }), shapeCheck: expectUndefined },
  {
    command: 'discover_agent_models',
    args: () => ({}),
    shapeCheck: (r) => (isRecord(r) && Array.isArray(r.models) ? ok() : fail('missing models array'))
  },
  { command: 'list_teams', args: () => ({}), shapeCheck: expectArray },
  { command: 'reconcile_managed_agent_runtimes', args: () => ({}), shapeCheck: expectArray },
  { command: 'list_managed_agent_runtimes', args: () => ({}), shapeCheck: expectArray },
  { command: 'list_personas', args: () => ({}), shapeCheck: expectArray },
  {
    command: 'create_persona',
    args: () => ({
      input: { displayName: 'Verify Persona', systemPrompt: 'verification probe', model: 'claude' }
    }),
    shapeCheck: (r) =>
      hasStringField(r, 'id') && isRecord(r) && r.display_name === 'Verify Persona'
        ? ok()
        : fail(`unexpected persona shape: ${JSON.stringify(r)}`),
    capture: (r, ctx) => {
      if (isRecord(r) && typeof r.id === 'string') {ctx.personaId = r.id}
    }
  },
  {
    command: 'update_persona',
    args: (ctx) => ({ input: { id: ctx.personaId, displayName: 'Verify Persona Updated' } }),
    shapeCheck: (r) =>
      isRecord(r) && r.display_name === 'Verify Persona Updated'
        ? ok()
        : fail(`persona name was not updated: ${JSON.stringify(r)}`)
  },
  {
    command: 'list_managed_agents',
    args: () => ({}),
    shapeCheck: (r, ctx) => {
      if (!Array.isArray(r)) {return fail('expected an array')}
      const mine = r.find((agent) => isRecord(agent) && agent.backend_agent_id === ctx.personaId)
      return mine ? ok() : fail('created persona did not appear in list_managed_agents')
    },
    capture: (r, ctx) => {
      if (!Array.isArray(r)) {return}
      const mine = r.find((agent) => isRecord(agent) && agent.backend_agent_id === ctx.personaId)
      if (isRecord(mine) && typeof mine.pubkey === 'string') {ctx.managedAgentPubkey = mine.pubkey}
    }
  },
  {
    command: 'create_managed_agent',
    args: (ctx) => ({ input: { personaId: ctx.personaId } }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && isRecord(r.agent) && r.agent.backend_agent_id === ctx.personaId
        ? ok()
        : fail(`unexpected create_managed_agent shape: ${JSON.stringify(r)}`)
  },
  {
    command: 'start_managed_agent',
    args: (ctx) => ({ pubkey: ctx.managedAgentPubkey }),
    shapeCheck: (r) => (isRecord(r) && r.status === 'running' ? ok() : fail(`not running: ${JSON.stringify(r)}`))
  },
  {
    command: 'stop_managed_agent',
    args: (ctx) => ({ pubkey: ctx.managedAgentPubkey }),
    shapeCheck: (r) => (isRecord(r) && r.status === 'stopped' ? ok() : fail(`not stopped: ${JSON.stringify(r)}`))
  },
  {
    // Real dispatch, but expected to end in an honest ERROR in this harness:
    // see runtime-bridge-harness.ts's makeUnconfiguredRuntimeStub doc.
    // No shapeCheck needed — a throw is classified before shapeCheck runs.
    command: 'discover_acp_providers',
    args: () => ({}),
    shapeCheck: expectArray
  },
  ...CORE_CHANNEL_STEPS
]

/**
 * Tears down the live world CORE_SETUP_STEPS established, after every
 * family's steps have had a chance to operate on it. Split out from setup
 * (see GAP 1 in the harness's report — build-agent-lifecycle needed a live
 * persona/managed-agent record to survive past core's own steps, which the
 * original single CORE_SCENARIO_STEPS array deleted before any family ran)
 * — moved here, in original relative order, unchanged otherwise:
 * `delete_persona` (was immediately after `discover_acp_providers`) and the
 * archive/unarchive/join/leave/delete channel cycle (was immediately after
 * the message-CRUD steps). Nothing else about CORE's step order changed.
 */
export const CORE_TEARDOWN_STEPS: ScenarioStep[] = [
  {
    command: 'delete_persona',
    args: (ctx) => ({ id: ctx.personaId }),
    shapeCheck: expectUndefined
  },
  {
    // The switch case awaits setDobiusChannelArchived (which internally
    // computes and returns the updated channel-detail object) but then
    // discards it and returns undefined to the caller — verified at
    // dobiusCommunications.ts's `case "archive_channel"`. That is the real,
    // intended contract (mirrors `leave_channel`'s own `Promise<void>`
    // handler), not a harness bug, so the oracle checks for undefined
    // rather than the channel object.
    command: 'archive_channel',
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'unarchive_channel',
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'join_channel',
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  { command: 'leave_channel', args: (ctx) => ({ channelId: ctx.channelId }), shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  { command: 'delete_channel', args: (ctx) => ({ channelId: ctx.channelId }), shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  }
]
