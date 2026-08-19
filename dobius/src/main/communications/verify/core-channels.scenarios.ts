/**
 * CORE scenario steps, part 2: channels, membership, messages, profiles, DM
 * and feed.
 *
 * Split from core.scenarios.ts purely to stay under the repo's max-lines
 * limit; the seam is `get_channels`, where core stops exercising identity
 * and personas and starts exercising channels. Steps are verbatim and stay
 * in their original order — core.scenarios.ts concatenates part 1 and this
 * back together into CORE_SETUP_STEPS, so runtime ordering is unchanged.
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

export const CORE_CHANNEL_STEPS: ScenarioStep[] = [
  { command: 'get_channels', args: () => ({}), shapeCheck: expectArray },
  {
    command: 'create_channel',
    args: () => ({ name: 'Verify Channel', channelType: 'stream', visibility: 'open' }),
    shapeCheck: (r) =>
      isRecord(r) && hasStringField(r, 'id') && r.name === 'Verify Channel'
        ? ok()
        : fail(`unexpected channel shape: ${JSON.stringify(r)}`),
    capture: (r, ctx) => {
      if (isRecord(r) && typeof r.id === 'string') {ctx.channelId = r.id}
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
      if (isRecord(r) && typeof r.event_id === 'string') {ctx.eventId = r.event_id}
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
      if (typeof r !== 'string') {return fail('expected a JSON string')}
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
