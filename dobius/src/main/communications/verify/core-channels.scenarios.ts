/**
 * CORE scenario steps, part 2: channels and membership, plus the
 * concatenation point for the message-family steps.
 *
 * Split from core.scenarios.ts purely to stay under the repo's max-lines
 * limit; the seam is `get_channels`, where core stops exercising identity
 * and personas and starts exercising channels. The message/reaction/
 * profile/DM/feed half lives in core-messages.scenarios.ts and is appended
 * below, so core.scenarios.ts still concatenates one CORE_CHANNEL_STEPS
 * array into CORE_SETUP_STEPS and runtime ordering is unchanged.
 *
 * SEAM — every step here is relay-protocol work with no bridge method and
 * no vendor case left to ride: each carries a `direct` helper from
 * ./relay-world-ops.ts that signs through the main-process participant
 * identity (signParticipantEvent) and submits/queries the harness relay's
 * /events and /query routes. See that module's header for the runner
 * contract and the ctx.family.participantPubkey authorship rule — these
 * steps' events are NOT authored by ctx.selfPubkey.
 */
import {
  fail,
  isRecord,
  hasStringField,
  ok,
  expectUndefined,
  expectArray
} from '../scenario-contract'
import {
  PARTICIPANT_PUBKEY_KEY,
  VERIFY_CHANNEL_NAME,
  addChannelMembersWorld,
  changeChannelMemberRoleWorld,
  createChannelWorld,
  ensureStarterChannelsWorld,
  getChannelDetailsWorld,
  getChannelMembersWorld,
  getChannelsWorld,
  removeChannelMemberWorld,
  setChannelPurposeWorld,
  setChannelTopicWorld,
  updateChannelDescriptionWorld,
  type DirectScenarioStep
} from './relay-world-ops'
import { CORE_MESSAGE_STEPS } from './core-messages.scenarios'

/** The world signer's captured pubkey — the authorship-oracle anchor. */
export function capturedSigner(ctx: { family: Record<string, unknown> }): unknown {
  return ctx.family[PARTICIPANT_PUBKEY_KEY]
}

export const CORE_CHANNEL_STEPS: DirectScenarioStep[] = [
  {
    command: 'get_channels',
    direct: getChannelsWorld,
    args: () => ({}),
    shapeCheck: expectArray
  },
  {
    command: 'create_channel',
    direct: createChannelWorld,
    args: () => ({ name: VERIFY_CHANNEL_NAME, channelType: 'stream', visibility: 'open' }),
    shapeCheck: (r) => {
      if (!isRecord(r) || !hasStringField(r, 'id') || r.name !== VERIFY_CHANNEL_NAME) {
        return fail(`unexpected channel shape: ${JSON.stringify(r)}`)
      }
      return r.channel_type === 'stream' && r.visibility === 'open'
        ? ok()
        : fail(`channel did not persist as created: ${JSON.stringify(r)}`)
    },
    capture: (r, ctx) => {
      if (isRecord(r) && typeof r.id === 'string') {
        ctx.channelId = r.id
      }
    }
  },
  {
    // Read-back proves the metadata event the relay stored round-trips.
    command: 'get_channel_details',
    direct: getChannelDetailsWorld,
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && r.id === ctx.channelId && r.name === VERIFY_CHANNEL_NAME
        ? ok()
        : fail(`channel details mismatch: ${JSON.stringify(r)}`)
  },
  {
    // Rewrites the channel's kind-39000 event under the same d tag — hence
    // the second-boundary wait (RelayStore tie-breaks same-second writes by
    // id order, not call order).
    command: 'update_channel',
    direct: updateChannelDescriptionWorld,
    args: (ctx) => ({ input: { channelId: ctx.channelId, description: 'verify description' } }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && r.id === ctx.channelId && r.description === 'verify description'
        ? ok()
        : fail(`description not updated: ${JSON.stringify(r)}`),
    requiresSecondBoundary: true
  },
  {
    command: 'set_channel_topic',
    direct: setChannelTopicWorld,
    args: (ctx) => ({ channelId: ctx.channelId, topic: 'verify-topic' }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'set_channel_purpose',
    direct: setChannelPurposeWorld,
    args: (ctx) => ({ channelId: ctx.channelId, purpose: 'verify-purpose' }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'get_channel_members',
    direct: getChannelMembersWorld,
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !Array.isArray(r.members)) {
        return fail('missing members array')
      }
      const self = r.members.find(
        (member) => isRecord(member) && member.pubkey === capturedSigner(ctx)
      )
      return isRecord(self) && self.role === 'owner'
        ? ok()
        : fail(`world signer missing from members or not owner: ${JSON.stringify(r.members)}`)
    }
  },
  {
    // Membership rewrite (kind 39002, same d tag).
    command: 'add_channel_members',
    direct: addChannelMembersWorld,
    args: (ctx) => ({ channelId: ctx.channelId, pubkeys: [ctx.otherPubkey] }),
    shapeCheck: (r, ctx) =>
      isRecord(r) && Array.isArray(r.added) && r.added.includes(ctx.otherPubkey)
        ? ok()
        : fail(`unexpected add_channel_members shape: ${JSON.stringify(r)}`),
    requiresSecondBoundary: true
  },
  {
    command: 'change_channel_member_role',
    direct: changeChannelMemberRoleWorld,
    args: (ctx) => ({ channelId: ctx.channelId, pubkey: ctx.otherPubkey, role: 'admin' }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'remove_channel_member',
    direct: removeChannelMemberWorld,
    args: (ctx) => ({ channelId: ctx.channelId, pubkey: ctx.otherPubkey }),
    shapeCheck: expectUndefined,
    requiresSecondBoundary: true
  },
  {
    command: 'ensure_starter_channels',
    direct: ensureStarterChannelsWorld,
    args: () => ({}),
    shapeCheck: (r) =>
      Array.isArray(r) && r.some((channel) => isRecord(channel) && channel.id === 'general')
        ? ok()
        : fail('expected the "general" starter channel')
  },
  ...CORE_MESSAGE_STEPS
]
