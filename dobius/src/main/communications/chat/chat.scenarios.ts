/**
 * Scenario fixtures for this feature's 22 commands
 * (relay-lifecycle, channels-membership, messages-dm slices — see
 * command-manifest.json), for the communications command verification
 * harness's composable scenario registry
 * (src/main/communications/verify/command-scenario.ts's `SCENARIO_STEPS`
 * family contract — see that file's top doc comment). The harness owner
 * splices this in with one import + one array-spread in that file; this
 * module never edits verify/ itself.
 *
 * Types/helpers come from '../scenario-contract', not
 * '../verify/command-scenario' — that path fails `tsc` with TS6307 under
 * config/tsconfig.node.json, since verify/ is an excluded composite
 * project (confirmed by a sibling family's mistake this session,
 * huddles.scenarios.ts). scenario-contract.ts lives outside verify/
 * specifically so every family can import the real, shared types instead of
 * each hand-copying a structurally-similar one under a different name.
 *
 * SETUP CONSTRAINT — no re-using a command name another family (or CORE)
 * already claimed: the harness's "every manifest command was verified
 * exactly once" check fails if the same command name appears twice in the
 * composed SCENARIO array. CORE already owns `create_channel`,
 * `send_channel_message`, and `open_dm`, so this module cannot mint its own
 * channel/message/DM to test against — it reuses what CORE's own steps
 * already created (`ctx.channelId`, `ctx.eventId`) and, for the DM case,
 * independently re-derives the deterministic DM channel id our relay
 * computes server-side (see `deriveDmChannelId` below) rather than calling
 * `open_dm` again. See the SCENARIOS section of this task's report for the
 * two commands (`get_forum_posts`/`list_relay_agents`) where this
 * constraint means the fixture can only exercise the real, correctly-shaped
 * EMPTY-result path rather than a populated one.
 */
import { createHash } from 'node:crypto'
import { expectArray, expectUndefined, fail, hasStringField, isRecord, ok, type ScenarioStep } from '../scenario-contract'

/**
 * Matches src/main/communications/relay/relay-dm.ts's `deriveChannelId`
 * exactly: sha256 of the sorted, deduplicated participant pubkeys joined by
 * a comma. Re-derives the id CORE's own `open_dm` step already provisioned
 * (self + otherPubkey) instead of calling `open_dm` again, which the
 * "no repeated command name" constraint above rules out.
 */
function deriveDmChannelId(participants: readonly string[]): string {
  return createHash('sha256').update([...participants].sort().join(',')).digest('hex')
}

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    command: 'get_default_relay_url',
    args: () => ({}),
    shapeCheck: (r) => (r === 'ws://localhost:3300' ? ok() : fail(`unexpected default relay url: ${JSON.stringify(r)}`))
  },
  {
    command: 'auto_connect_default_relay_enabled',
    args: () => ({}),
    shapeCheck: (r) => (r === true ? ok() : fail(`expected true, got ${JSON.stringify(r)}`))
  },
  {
    command: 'relay_reconnect_hook_configured',
    args: () => ({}),
    shapeCheck: (r) => (r === false ? ok() : fail(`expected false, got ${JSON.stringify(r)}`))
  },
  {
    command: 'relay_reconnect_hook',
    args: () => ({}),
    shapeCheck: expectUndefined
  },
  {
    command: 'relay_requires_membership',
    args: () => ({}),
    shapeCheck: (r) => (r === false ? ok() : fail(`expected false, got ${JSON.stringify(r)}`))
  },
  {
    // No 9030/9031/9032 admin action has run yet (those are exercised below,
    // and nothing else in CORE touches kind 13534), so this must land on
    // the bootstrap-owner path: the local identity, alone, as "owner".
    command: 'list_relay_members',
    args: () => ({}),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !Array.isArray(r.members) || r.members.length !== 1) {
        return fail(`expected a one-row bootstrap member list: ${JSON.stringify(r)}`)
      }
      const [member] = r.members
      return isRecord(member) && member.pubkey === ctx.selfPubkey && member.role === 'owner'
        ? ok()
        : fail(`expected self as bootstrap owner: ${JSON.stringify(member)}`)
    }
  },
  {
    command: 'get_my_relay_membership',
    args: () => ({}),
    shapeCheck: (r, ctx) =>
      isRecord(r) && r.pubkey === ctx.selfPubkey && r.role === 'owner'
        ? ok()
        : fail(`expected self as bootstrap owner: ${JSON.stringify(r)}`)
  },
  {
    command: 'add_relay_member',
    args: (ctx) => ({ targetPubkey: ctx.otherPubkey, role: 'member' }),
    shapeCheck: expectUndefined
  },
  {
    command: 'change_relay_member_role',
    args: (ctx) => ({ targetPubkey: ctx.otherPubkey, newRole: 'admin' }),
    shapeCheck: expectUndefined
  },
  {
    command: 'remove_relay_member',
    args: (ctx) => ({ targetPubkey: ctx.otherPubkey }),
    shapeCheck: expectUndefined
  },
  {
    command: 'set_contact_list',
    args: (ctx) => ({
      contacts: [{ pubkey: ctx.otherPubkey, relay_url: 'wss://relay.example', petname: 'Scenario Contact' }]
    }),
    shapeCheck: (r) =>
      hasStringField(r, 'event_id') && isRecord(r) && r.accepted === true
        ? ok()
        : fail(`unexpected set_contact_list shape: ${JSON.stringify(r)}`)
  },
  {
    // Round-trips the write above: kind 3 is replaceable-per-author, so
    // reading self's own list back must show the contact just published.
    command: 'get_contact_list',
    args: (ctx) => ({ pubkey: ctx.selfPubkey }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && Array.isArray(r.tags) && r.tags.some((tag) => Array.isArray(tag) && tag[0] === 'p' && tag[1] === ctx.otherPubkey)
        ? ok()
        : fail(`contact not found in list: ${JSON.stringify(r)}`)
  },
  {
    // otherPubkey never authors anything in this scenario, so it is
    // deterministically "offline"; selfPubkey is always "online".
    command: 'get_presence',
    args: (ctx) => ({ pubkeys: [ctx.selfPubkey, ctx.otherPubkey] }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && r[ctx.selfPubkey] === 'online' && r[ctx.otherPubkey] === 'offline'
        ? ok()
        : fail(`unexpected presence: ${JSON.stringify(r)}`)
  },
  {
    // Reuses CORE's own channel + message (`ctx.channelId`/`ctx.eventId`
    // from its `create_channel`/`send_channel_message` steps) rather than
    // minting a new one — see this file's top doc comment.
    command: 'get_channel_messages_before',
    args: (ctx) => ({ channelId: ctx.channelId, limit: 10 }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && Array.isArray(r.events) && r.events.some((event) => isRecord(event) && event.id === ctx.eventId)
        ? ok()
        : fail(`expected CORE's message in the page: ${JSON.stringify(r)}`)
  },
  {
    // No kind-45001 forum post has ever been published to CORE's channel
    // (create_channel/send_channel_message are already claimed by CORE, so
    // this module cannot mint one — see this file's top doc comment). This
    // still exercises the real relay round trip and asserts the correctly
    // shaped EMPTY result, not merely "didn't throw".
    command: 'get_forum_posts',
    args: (ctx) => ({ channelId: ctx.channelId, limit: 10 }),
    shapeCheck: (r) =>
      isRecord(r) && Array.isArray(r.messages) && r.messages.length === 0 && r.next_cursor === null
        ? ok()
        : fail(`expected an empty forum page: ${JSON.stringify(r)}`)
  },
  {
    // `getDobiusForumThread`'s root lookup is by event id alone (no kind
    // filter), so CORE's plain kind-9 message is a legitimate root to probe
    // — this exercises the real root lookup + zero-replies path end to end.
    command: 'get_forum_thread',
    args: (ctx) => ({ eventId: ctx.eventId, limit: 10 }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && isRecord(r.root) && r.root.event_id === ctx.eventId && Array.isArray(r.replies) && r.replies.length === 0 && r.total_replies === 0
        ? ok()
        : fail(`unexpected forum thread shape: ${JSON.stringify(r)}`)
  },
  {
    // Re-derives the DM channel id CORE's own `open_dm` step already
    // provisioned, instead of calling `open_dm` again — see
    // `deriveDmChannelId`'s doc comment.
    command: 'hide_dm',
    args: (ctx) => ({ channelId: deriveDmChannelId([ctx.selfPubkey, ctx.otherPubkey]) }),
    shapeCheck: expectUndefined
  },
  {
    // CORE deletes its persona/managed agent before this family runs, so
    // there is no live agent to project — this asserts the real, correctly
    // shaped empty-array path (agent.list/agent.runs + kind-39002 lookup all
    // genuinely execute) rather than a populated one. See this file's top
    // doc comment and the report's SCENARIOS section.
    command: 'list_relay_agents',
    args: () => ({}),
    shapeCheck: expectArray
  },
  {
    command: 'get_relay_self',
    args: () => ({}),
    shapeCheck: (r) => (r === null ? ok() : fail(`expected null, got ${JSON.stringify(r)}`))
  },
  {
    command: 'fetch_join_policy',
    args: () => ({ relayUrl: 'ws://localhost:3300' }),
    shapeCheck: (r) => (r === null ? ok() : fail(`expected null, got ${JSON.stringify(r)}`))
  },
  {
    // A .invalid TLD (IANA-reserved to never resolve) makes the fetch fail
    // deterministically, exercising the real network path and its catch ->
    // null fallback, rather than the href-missing short-circuit.
    command: 'fetch_link_preview_title',
    args: () => ({ href: 'https://verification-probe.invalid/' }),
    shapeCheck: (r) => (r === null ? ok() : fail(`expected null for an unreachable host, got ${JSON.stringify(r)}`))
  },
  {
    // Republishes kind 0 (CORE's own `update_profile` step already wrote
    // one) — `requiresSecondBoundary` avoids the same-second addressable/
    // replaceable tie-break risk `relay-store.ts`'s `supersedes()` documents,
    // even though the team brief scoped that flag to kind 39000/39002; the
    // same tie-break mechanism applies to any replaceable kind, and kind 0
    // was already written once earlier in this same run.
    command: 'update_profile_at_relay',
    args: (ctx) => ({
      relayUrl: 'ws://localhost:3300',
      expectedPubkey: ctx.selfPubkey,
      expectedAvatarUrl: null,
      avatarUrl: 'https://example.com/avatar-scenario.png'
    }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && r.avatar_url === 'https://example.com/avatar-scenario.png' && r.pubkey === ctx.selfPubkey
        ? ok()
        : fail(`avatar not applied: ${JSON.stringify(r)}`),
    requiresSecondBoundary: true
  }
]
