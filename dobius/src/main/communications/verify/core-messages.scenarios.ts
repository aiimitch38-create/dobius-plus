/**
 * CORE scenario steps, part 4: messages, reactions, threads, search,
 * profiles, users, DM and feed. Split from core-channels.scenarios.ts to
 * keep every file under the repo's max-lines limit; core-channels.scenarios.ts
 * concatenates this back into CORE_CHANNEL_STEPS, so runtime ordering is
 * unchanged.
 *
 * SEAM — same as core-channels.scenarios.ts: every step here is
 * relay-protocol work with no bridge method and no vendor case left to
 * ride; each carries a `direct` helper from ./relay-world-ops.ts. The
 * captured world-signer oracle helper stays in core-channels.scenarios.ts
 * and is imported from there.
 */
import {
  fail,
  hasStringField,
  isRecord,
  ok,
  expectArray,
  expectUndefined,
  type ShapeOutcome
} from '../scenario-contract'
import { capturedSigner } from './core-channels.scenarios'
import {
  VERIFY_EDITED_CONTENT,
  VERIFY_MESSAGE_CONTENT,
  VERIFY_PROFILE_ABOUT,
  VERIFY_PROFILE_NAME,
  VERIFY_REACTION_EMOJI,
  addReactionWorld,
  deleteMessageWorld,
  editMessageWorld,
  feedWorldSnapshot,
  getChannelWindowWorld,
  getEventWorld,
  getProfileWorld,
  getThreadRepliesWorld,
  getUserProfileWorld,
  getUsersBatchWorld,
  openDmWorld,
  removeReactionWorld,
  searchMessagesWorld,
  searchUsersWorld,
  sendChannelMessageWorld,
  updateProfileWorld,
  type DirectScenarioStep
} from './relay-world-ops'

function expectHex64(value: unknown): ShapeOutcome {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
    ? ok()
    : fail(`expected 64-hex, got ${JSON.stringify(value)}`)
}

/** Message-family steps; concatenated after the channel/membership block. */
export const CORE_MESSAGE_STEPS: DirectScenarioStep[] = [
  {
    // Publishes kind 9 ("h" tag names the channel); the relay accepts it
    // synchronously, so the returned id is queryable immediately.
    command: 'send_channel_message',
    direct: sendChannelMessageWorld,
    args: (ctx) => ({ channelId: ctx.channelId, content: VERIFY_MESSAGE_CONTENT }),
    shapeCheck: (r) => (hasStringField(r, 'event_id') ? ok() : fail('missing event_id')),
    capture: (r, ctx) => {
      if (isRecord(r) && typeof r.event_id === 'string') {
        ctx.eventId = r.event_id
      }
    }
  },
  {
    command: 'get_channel_window',
    direct: getChannelWindowWorld,
    args: (ctx) => ({ channelId: ctx.channelId, limitRows: 10, cursor: null }),
    shapeCheck: (r, ctx) => {
      if (!Array.isArray(r)) {
        return expectArray(r)
      }
      const mine = r.find((row) => isRecord(row) && row.id === ctx.eventId)
      if (!mine) {
        return fail('sent message missing from its own channel window')
      }
      const ascending = r.every(
        (row, index) =>
          index === 0 ||
          ((r[index - 1] as Record<string, unknown>).created_at as number) <=
            ((row as Record<string, unknown>).created_at as number)
      )
      return ascending ? ok() : fail('window rows not in oldest-first timeline order')
    }
  },
  {
    command: 'get_event',
    direct: getEventWorld,
    args: (ctx) => ({ eventId: ctx.eventId }),
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
      if (!isRecord(parsed) || parsed.id !== ctx.eventId) {
        return fail('event id mismatch')
      }
      return parsed.content === VERIFY_MESSAGE_CONTENT &&
        parsed.pubkey === capturedSigner(ctx)
        ? ok()
        : fail(`stored message diverged from what was sent: ${JSON.stringify(parsed)}`)
    }
  },
  {
    // Honest zero: nothing in this world replies to the root before this
    // step runs, so an empty thread is the true state of the store.
    command: 'get_thread_replies',
    direct: getThreadRepliesWorld,
    args: (ctx) => ({ rootEventId: ctx.eventId }),
    shapeCheck: (r) => {
      if (!isRecord(r) || !Array.isArray(r.events)) {
        return fail('missing events array')
      }
      return r.events.length === 0
        ? ok()
        : fail(`expected no thread replies yet, got ${JSON.stringify(r.events.length)}`)
    }
  },
  {
    // This relay drops NIP-01 `search` server-side (relay-filters.ts), so
    // matching happens client-side over the fetched window; assert our
    // message really matched rather than accepting any hits array.
    command: 'search_messages',
    direct: searchMessagesWorld,
    args: () => ({ q: 'verification' }),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !Array.isArray(r.hits)) {
        return fail('missing hits array')
      }
      const mine = r.hits.find((hit) => isRecord(hit) && hit.event_id === ctx.eventId)
      return isRecord(mine) && mine.content === VERIFY_MESSAGE_CONTENT
        ? ok()
        : fail(`search did not surface the sent message: ${JSON.stringify(r.hits)}`)
    }
  },
  {
    // Kind-40003 edit overlay over the stored message.
    command: 'edit_message',
    direct: editMessageWorld,
    args: (ctx) => ({ channelId: ctx.channelId, eventId: ctx.eventId, content: VERIFY_EDITED_CONTENT }),
    shapeCheck: expectUndefined
  },
  {
    command: 'add_reaction',
    direct: addReactionWorld,
    args: (ctx) => ({ eventId: ctx.eventId, emoji: VERIFY_REACTION_EMOJI }),
    shapeCheck: expectUndefined
  },
  {
    // Finds the signer's own kind-7 reaction by "#e" + content and deletes
    // it via NIP-09 kind 5 — a silent no-op when nothing matched, exactly
    // like the vendored case.
    command: 'remove_reaction',
    direct: removeReactionWorld,
    args: (ctx) => ({ eventId: ctx.eventId, emoji: VERIFY_REACTION_EMOJI }),
    shapeCheck: expectUndefined
  },
  {
    command: 'delete_message',
    direct: deleteMessageWorld,
    args: (ctx) => ({ channelId: ctx.channelId, eventId: ctx.eventId }),
    shapeCheck: expectUndefined
  },
  {
    // Kind-0 profile publish; replaceable per (pubkey, kind).
    command: 'update_profile',
    direct: updateProfileWorld,
    args: () => ({ displayName: VERIFY_PROFILE_NAME, about: VERIFY_PROFILE_ABOUT }),
    shapeCheck: (r) =>
      isRecord(r) && r.display_name === VERIFY_PROFILE_NAME
        ? ok()
        : fail('display_name not updated')
  },
  {
    command: 'get_profile',
    direct: getProfileWorld,
    args: () => ({}),
    shapeCheck: (r, ctx) =>
      isRecord(r) &&
      r.display_name === VERIFY_PROFILE_NAME &&
      r.pubkey === capturedSigner(ctx) &&
      r.about === VERIFY_PROFILE_ABOUT
        ? ok()
        : fail(`profile did not persist for the world signer: ${JSON.stringify(r)}`)
  },
  {
    // Targets the world signer on purpose: ctx.selfPubkey belongs to the
    // retired renderer localStorage identity and authors nothing now.
    command: 'get_user_profile',
    direct: getUserProfileWorld,
    args: (ctx) => ({ pubkey: capturedSigner(ctx) ?? ctx.selfPubkey }),
    shapeCheck: (r, ctx) =>
      isRecord(r) &&
      r.display_name === VERIFY_PROFILE_NAME &&
      r.pubkey === capturedSigner(ctx)
        ? ok()
        : fail(`profile lookup missed the world signer: ${JSON.stringify({ got: r, signer: capturedSigner(ctx) })}`)
  },
  {
    command: 'get_users_batch',
    direct: getUsersBatchWorld,
    args: (ctx) => ({ pubkeys: [capturedSigner(ctx) ?? ctx.selfPubkey] }),
    shapeCheck: (r, ctx) => {
      const signer = capturedSigner(ctx)
      if (!isRecord(r) || !isRecord(r.profiles)) {
        return fail(`missing profiles map: ${JSON.stringify(r)}`)
      }
      return isRecord(r.profiles[signer as string]) && Array.isArray(r.missing) && r.missing.length === 0
        ? ok()
        : fail(`signer missing from profiles batch: ${JSON.stringify(r)}`)
    }
  },
  {
    command: 'search_users',
    direct: searchUsersWorld,
    args: () => ({ query: 'Verify' }),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !Array.isArray(r.users)) {
        return fail('missing users array')
      }
      const signer = capturedSigner(ctx)
      const mine = r.users.find(
        (user) => isRecord(user) && user.pubkey === signer && user.display_name === VERIFY_PROFILE_NAME
      )
      return mine ? ok() : fail(`profile search did not surface the signer: ${JSON.stringify(r.users)}`)
    }
  },
  {
    // Kind-41010 open request; the relay provisions the DM channel
    // server-side and returns its id in the response body.
    command: 'open_dm',
    direct: openDmWorld,
    args: (ctx) => ({ pubkeys: [ctx.otherPubkey] }),
    shapeCheck: (r) => {
      if (!isRecord(r) || r.channel_type !== 'dm') {
        return fail(`unexpected open_dm shape: ${JSON.stringify(r)}`)
      }
      const hex = expectHex64(r.id)
      return hex.ok ? ok() : fail(`dm channel id invalid: ${hex.reason}`)
    }
  },
  {
    command: 'get_feed',
    direct: feedWorldSnapshot,
    args: () => ({}),
    shapeCheck: (r) => (isRecord(r) && isRecord(r.feed) && isRecord(r.meta) ? ok() : fail('missing feed/meta'))
  }
]
