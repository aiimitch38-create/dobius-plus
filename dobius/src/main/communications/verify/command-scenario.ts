/**
 * Composable scenario registry for the communications command verification
 * harness's dispatch runner (run-verification.test.ts).
 *
 * THIS FILE IS THE COMPOSER, not the only source of scenario steps. A
 * feature agent implementing a command family (chat, identity, native,
 * huddles, agents, ...) writes their own `<family>.scenarios.ts` next to
 * their feature code, in their OWN directory — never here — and exports:
 *
 *   export const SCENARIO_STEPS: ScenarioStep[]
 *
 * importing `ScenarioStep`, `ScenarioContext`, `ShapeOutcome`, and the
 * shared helpers from `../scenario-contract.ts` (NOT from this file — see
 * that module's doc comment for why the contract lives there and not here:
 * short version, config/tsconfig.node.json excludes this whole `verify/`
 * directory, so a family file importing from here hits TS6307). This file
 * only imports each family's `SCENARIO_STEPS` and concatenates them — see
 * the FAMILY IMPORTS section further down. That keeps six agents from ever
 * touching the same file: a new family lands as a two-line addition here
 * (one import, one array-spread), never a merge conflict.
 *
 * This file still re-exports everything from `../scenario-contract` below,
 * so `'../verify/command-scenario'` keeps working for anything already
 * importing from it (teams.scenarios.ts, huddles.scenarios.ts as
 * originally written) — Node/Vitest resolve that import fine regardless of
 * tsc project boundaries. Only `config/tsconfig.node.json` cares about the
 * boundary, which is why NEW family modules should import the contract
 * directly from `../scenario-contract` instead.
 *
 * ORIGINAL CORE: the 54 commands this harness's first version hand-built
 * fixtures for (identity, relay lifecycle, channels, messages, agent
 * lifecycle, teams-snapshots) stay inline below, split into
 * `CORE_SETUP_STEPS` (establishes a live persona/managed agent/channel/
 * message/DM) and `CORE_TEARDOWN_STEPS` (deletes them) with every family's
 * steps spliced in between — see the ORDERING doc comment further down for
 * why. No reason to split my own, already-owned content into a separate
 * file just to mirror the family pattern.
 *
 * Only commands with a scenario step (core or family) get a hand-built
 * fixture + oracle. Every other command (pending, removed-pending, or a
 * family's commands before that family lands) is dispatched with `{}` and
 * no oracle in run-verification.test.ts's Pass 2 — safe for a genuinely
 * unimplemented command (`invokeDobiusBackedTauriCommand`'s switch in
 * dobiusCommunications.ts dispatches on command name alone, so it throws
 * the fixed "not implemented" error regardless of arguments), but NOT
 * safe to read as a "still broken" signal once a command gains a real
 * implementation before it has a scenario — see PASS2_FIX in this task's
 * report for how run-verification.test.ts now labels that case distinctly.
 *
 * GRACEFUL DEGRADATION POLICY: a family's import line is added to this file
 * ONLY once that family's `<family>.scenarios.ts` actually exists on disk —
 * never pre-wired speculatively. A static `import` of a file that doesn't
 * exist yet fails to resolve and crashes every test in this directory, not
 * just the missing family's commands, so there is no safe way to guess
 * ahead. Until a family lands, its commands simply aren't in SCENARIO yet
 * and fall through to Pass 2 (empty-args fallback, not a crash).
 */
export {
  type ShapeOutcome,
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
import {
  ok,
  fail,
  isRecord,
  hasStringField,
  expectUndefined,
  expectArray,
  type ScenarioStep
} from '../scenario-contract'

/**
 * The 54 commands this harness's first version hand-built fixtures for.
 * Each step's `args` receives the context accumulated by every earlier
 * step's `capture` — core steps run first (see ORDERING below), so a
 * family module can rely on `ctx.channelId`/`ctx.personaId`/etc. being
 * populated if it needs an existing channel/persona/agent to test against.
 */
const CORE_SETUP_STEPS: ScenarioStep[] = [
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
      if (typeof r !== 'string') return fail('expected a JSON string')
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
      if (typeof r !== 'string') return fail('expected a JSON string')
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
      if (isRecord(r) && typeof r.id === 'string') ctx.personaId = r.id
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
      if (!Array.isArray(r)) return fail('expected an array')
      const mine = r.find((agent) => isRecord(agent) && agent.backend_agent_id === ctx.personaId)
      return mine ? ok() : fail('created persona did not appear in list_managed_agents')
    },
    capture: (r, ctx) => {
      if (!Array.isArray(r)) return
      const mine = r.find((agent) => isRecord(agent) && agent.backend_agent_id === ctx.personaId)
      if (isRecord(mine) && typeof mine.pubkey === 'string') ctx.managedAgentPubkey = mine.pubkey
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
  { command: 'get_channels', args: () => ({}), shapeCheck: expectArray },
  {
    command: 'create_channel',
    args: () => ({ name: 'Verify Channel', channelType: 'stream', visibility: 'open' }),
    shapeCheck: (r) =>
      isRecord(r) && hasStringField(r, 'id') && r.name === 'Verify Channel'
        ? ok()
        : fail(`unexpected channel shape: ${JSON.stringify(r)}`),
    capture: (r, ctx) => {
      if (isRecord(r) && typeof r.id === 'string') ctx.channelId = r.id
    }
  },
  {
    command: 'get_channel_details',
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: (r, ctx) => (isRecord(r) && r.id === ctx.channelId ? ok() : fail('channel id mismatch'))
  },
  {
    command: 'update_channel',
    args: (ctx) => ({ input: { channelId: ctx.channelId, description: 'verify description' } }),
    shapeCheck: (r) =>
      isRecord(r) && r.description === 'verify description' ? ok() : fail('description not updated'),
    requiresSecondBoundary: true
  },
  {
    command: 'set_channel_topic',
    args: (ctx) => ({ channelId: ctx.channelId, topic: 'verify-topic' }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'set_channel_purpose',
    args: (ctx) => ({ channelId: ctx.channelId, purpose: 'verify-purpose' }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'get_channel_members',
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: (r) => (isRecord(r) && Array.isArray(r.members) ? ok() : fail('missing members array'))
  },
  {
    command: 'add_channel_members',
    args: (ctx) => ({ channelId: ctx.channelId, pubkeys: [ctx.otherPubkey] }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && Array.isArray(r.added) && r.added.includes(ctx.otherPubkey)
        ? ok()
        : fail(`unexpected add_channel_members shape: ${JSON.stringify(r)}`),
    requiresSecondBoundary: true
  },
  {
    command: 'change_channel_member_role',
    args: (ctx) => ({ channelId: ctx.channelId, pubkey: ctx.otherPubkey, role: 'admin' }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'remove_channel_member',
    args: (ctx) => ({ channelId: ctx.channelId, pubkey: ctx.otherPubkey }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'ensure_starter_channels',
    args: () => ({}),
    shapeCheck: (r) =>
      Array.isArray(r) && r.some((channel) => isRecord(channel) && channel.id === 'general')
        ? ok()
        : fail('expected the "general" starter channel')
  },
  {
    command: 'send_channel_message',
    args: (ctx) => ({ channelId: ctx.channelId, content: 'verification message' }),
    shapeCheck: (r) => (hasStringField(r, 'event_id') ? ok() : fail('missing event_id')),
    capture: (r, ctx) => {
      if (isRecord(r) && typeof r.event_id === 'string') ctx.eventId = r.event_id
    }
  },
  {
    command: 'get_channel_window',
    args: (ctx) => ({ channelId: ctx.channelId, limitRows: 10, cursor: null }),
    shapeCheck: expectArray
  },
  {
    command: 'get_event',
    args: (ctx) => ({ eventId: ctx.eventId }),
    shapeCheck: (r, ctx) => {
      if (typeof r !== 'string') return fail('expected a JSON string')
      try {
        const parsed = JSON.parse(r)
        return isRecord(parsed) && parsed.id === ctx.eventId ? ok() : fail('event id mismatch')
      } catch {
        return fail('result was not valid JSON')
      }
    }
  },
  {
    command: 'get_thread_replies',
    args: (ctx) => ({ rootEventId: ctx.eventId }),
    shapeCheck: (r) => (isRecord(r) && Array.isArray(r.events) ? ok() : fail('missing events array'))
  },
  {
    command: 'search_messages',
    args: () => ({ q: 'verification' }),
    shapeCheck: (r) => (isRecord(r) && Array.isArray(r.hits) ? ok() : fail('missing hits array'))
  },
  {
    command: 'edit_message',
    args: (ctx) => ({ channelId: ctx.channelId, eventId: ctx.eventId, content: 'edited message' }),
    shapeCheck: expectUndefined
  },
  {
    command: 'add_reaction',
    args: (ctx) => ({ eventId: ctx.eventId, emoji: '\u{1F44D}' }),
    shapeCheck: expectUndefined
  },
  {
    command: 'remove_reaction',
    args: (ctx) => ({ eventId: ctx.eventId, emoji: '\u{1F44D}' }),
    shapeCheck: expectUndefined
  },
  {
    command: 'delete_message',
    args: (ctx) => ({ channelId: ctx.channelId, eventId: ctx.eventId }),
    shapeCheck: expectUndefined
  },
  {
    command: 'update_profile',
    args: () => ({ displayName: 'Verify User', about: 'verification bio' }),
    shapeCheck: (r) => (isRecord(r) && r.display_name === 'Verify User' ? ok() : fail('display_name not updated'))
  },
  {
    command: 'get_profile',
    args: () => ({}),
    shapeCheck: (r) => (isRecord(r) && r.display_name === 'Verify User' ? ok() : fail('profile did not persist'))
  },
  {
    command: 'get_user_profile',
    args: (ctx) => ({ pubkey: ctx.selfPubkey }),
    shapeCheck: (r) => (isRecord(r) && 'display_name' in r ? ok() : fail('missing display_name'))
  },
  {
    command: 'get_users_batch',
    args: (ctx) => ({ pubkeys: [ctx.selfPubkey] }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && isRecord(r.profiles) && ctx.selfPubkey in r.profiles
        ? ok()
        : fail(`self pubkey missing from profiles: ${JSON.stringify(r)}`)
  },
  {
    command: 'search_users',
    args: () => ({ query: 'Verify' }),
    shapeCheck: (r) => (isRecord(r) && Array.isArray(r.users) ? ok() : fail('missing users array'))
  },
  {
    command: 'open_dm',
    args: (ctx) => ({ pubkeys: [ctx.otherPubkey] }),
    shapeCheck: (r) => (isRecord(r) && r.channel_type === 'dm' ? ok() : fail(`unexpected open_dm shape: ${JSON.stringify(r)}`))
  },
  {
    command: 'get_feed',
    args: () => ({}),
    shapeCheck: (r) => (isRecord(r) && isRecord(r.feed) && isRecord(r.meta) ? ok() : fail('missing feed/meta'))
  }
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
const CORE_TEARDOWN_STEPS: ScenarioStep[] = [
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

// ---------------------------------------------------------------------
// FAMILY IMPORTS
//
// Add one import line here + one array-spread line in SCENARIO below, as a
// pair, ONLY once that family's `<family>.scenarios.ts` file exists on
// disk — see this file's top doc comment ("GRACEFUL DEGRADATION POLICY")
// for why a speculative import of a not-yet-written file is unsafe.
//
// Family modules should import the contract (ScenarioStep, ScenarioContext,
// ShapeOutcome, ok/fail/isRecord/hasStringField/expectUndefined/
// expectArray/randomHexPubkey) from '../scenario-contract' — NOT from
// '../verify/command-scenario' — so config/tsconfig.node.json can typecheck
// them without crossing this excluded directory's boundary (TS6307). See
// scenario-contract.ts's own doc comment for the full reasoning.
//
// Expected families (from the six agents this composer was built for):
//
// import { SCENARIO_STEPS as identitySteps } from '../identity/identity.scenarios'
//
// Landed: teams (create_team/update_team/delete_team) — not under a
// subdirectory like the others, since team-store.ts's family lives
// directly in src/main/communications/, so its scenario module does too.
import { SCENARIO_STEPS as teamsSteps } from '../teams.scenarios'
// Landed: huddles (voice-huddles lifecycle commands). Still imports the
// contract from '../verify/command-scenario' (this file re-exports it, so
// that keeps resolving at runtime) rather than the new '../scenario-contract'
// — reported to the harness's coordinator to have huddles.scenarios.ts's
// import line updated; not edited here (out of this composer's write scope).
import { SCENARIO_STEPS as huddlesSteps } from '../huddles/huddles.scenarios'
// Landed: chat (channels-membership/messages-dm/relay-lifecycle families).
import { SCENARIO_STEPS as chatSteps } from '../chat/chat.scenarios'
// Landed: native-ux (5 of 14 commands are headless-testable; see that
// file's own doc comment for which 9 are intentionally excluded).
import { SCENARIO_STEPS as nativeSteps } from '../native/native.scenarios'
// Landed: agent-lifecycle / agent-provider-config / agent-approvals.
import { SCENARIO_STEPS as agentsSteps } from '../agents/agents.scenarios'
// ---------------------------------------------------------------------

/**
 * ORDERING: `CORE_SETUP_STEPS` run FIRST, always — they establish
 * `selfPubkey`/`otherPubkey` (seeded by run-verification.test.ts) and
 * `channelId`/`personaId`/`managedAgentPubkey`/`eventId` (via their own
 * `capture` steps), and leave the persona/managed agent/channel/message/DM
 * all still LIVE (not yet deleted). Every family's steps run next, against
 * that live world, in the order they're spread below — if one family's
 * steps must run before another's (e.g. one captures a `ctx.family` key the
 * other reads), order them accordingly here; this composer, not the
 * families themselves, owns final ordering. `CORE_TEARDOWN_STEPS` run
 * LAST, always — deleting the persona and the channel only after every
 * family has had a chance to operate on them (see `CORE_TEARDOWN_STEPS`'s
 * own doc comment for why this is split from setup at all).
 *
 * A family step throwing does NOT abort this run or skip teardown: every
 * step (args/dispatch/shapeCheck/capture) runs inside its own try/catch in
 * run-verification.test.ts, so one bad fixture becomes that one command's
 * ERROR entry, never a crash that leaves the world un-torn-down for
 * whichever family runs next.
 */
export const SCENARIO: ScenarioStep[] = [
  ...CORE_SETUP_STEPS,
  ...teamsSteps,
  ...huddlesSteps,
  ...chatSteps,
  ...nativeSteps,
  ...agentsSteps,
  // , ...identitySteps
  ...CORE_TEARDOWN_STEPS
]

export const SCENARIO_COMMANDS = new Set(SCENARIO.map((step) => step.command))
