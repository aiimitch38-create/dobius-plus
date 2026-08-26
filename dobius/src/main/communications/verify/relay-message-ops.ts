/**
 * Message-family world operations for CORE's verification-gate scenarios:
 * channel messages, window/thread reads, search, edits, reactions,
 * deletions, kind-0 profiles, the mention home-feed projection, and DM
 * provisioning. Every event is signed through the shared wire primitives
 * in relay-world-wire.ts; see relay-world-ops.ts's header for the
 * direct-step contract and the identity-split rationale.
 */
import type { ScenarioContext } from '../scenario-contract'
import { signParticipantEvent } from '../participant-identity-store'
import { DM_OPEN_KIND } from '../relay/relay-dm'
import type { RelayQueriedEvent } from '../identity/relay-http-client'
import type { ChannelDetailView } from './relay-channel-ops'
import {
  BUZZ_DELETE_MESSAGE_KIND,
  CHANNEL_METADATA_KIND,
  DELETION_KIND,
  MESSAGE_EDIT_KIND,
  MESSAGE_KIND,
  MESSAGE_WINDOW_KINDS,
  PROFILE_KIND,
  REACTION_KIND,
  THREAD_REPLY_KINDS,
  eventTag,
  newestFirst,
  participantPubkey,
  publish,
  publishSignedEvent,
  queryRelay,
  requiredCtx,
  signerPubkey,
  submitRelayEventWithResponse
} from './relay-world-wire'

export const VERIFY_MESSAGE_CONTENT = 'verification message'
export const VERIFY_EDITED_CONTENT = 'edited message'
export const VERIFY_PROFILE_NAME = 'Verify User'
export const VERIFY_PROFILE_ABOUT = 'verification bio'
export const VERIFY_REACTION_EMOJI = '\u{1F44D}'

// ── messages, reactions, threads, search ────────────────────────────────────

export type SentMessageView = {
  event_id: string
  parent_event_id: null
  root_event_id: null
  depth: 0
  created_at: number
}

export async function sendChannelMessageWorld(ctx: ScenarioContext): Promise<SentMessageView> {
  const channelId = requiredCtx(ctx.channelId, 'channel id')
  const signed = signParticipantEvent({
    kind: MESSAGE_KIND,
    content: VERIFY_MESSAGE_CONTENT,
    tags: [['h', channelId]]
  })
  await publishSignedEvent(signed, 'The relay rejected the message.')
  return {
    event_id: signed.id,
    parent_event_id: null,
    root_event_id: null,
    depth: 0,
    created_at: signed.created_at
  }
}

export async function getChannelWindowWorld(ctx: ScenarioContext): Promise<RelayQueriedEvent[]> {
  const events = await queryRelay([
    { kinds: MESSAGE_WINDOW_KINDS, '#h': [requiredCtx(ctx.channelId, 'channel id')], limit: 10 }
  ])
  // Oldest-first: the vendor window served history in timeline order.
  return [...events].sort((left, right) => left.created_at - right.created_at)
}

export async function getEventWorld(ctx: ScenarioContext): Promise<string> {
  const eventId = requiredCtx(ctx.eventId, 'event id')
  const [event] = await queryRelay([{ ids: [eventId], limit: 1 }])
  if (!event) {
    throw new Error(`Message not found: ${eventId}`)
  }
  return JSON.stringify(event)
}

export async function getThreadRepliesWorld(ctx: ScenarioContext): Promise<{ events: RelayQueriedEvent[]; next_cursor: null }> {
  const events = await queryRelay([
    { kinds: THREAD_REPLY_KINDS, '#e': [requiredCtx(ctx.eventId, 'event id')], limit: 100 }
  ])
  return {
    events: [...events].sort(
      (left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id)
    ),
    next_cursor: null
  }
}

export type MessageSearchHit = {
  event_id: string
  content: string
  kind: number
  pubkey: string
  channel_id: string | null
  channel_name: null
  created_at: number
  score: number
}

/**
 * This relay implements no NIP-01 `search` key (dropped server-side, see
 * relay-filters.ts), so matching happens client-side over the fetched
 * window — the honest equivalent of the vendored query against THIS relay.
 */
export async function searchMessagesWorld(): Promise<{ hits: MessageSearchHit[]; found: number }> {
  const events = await queryRelay([{ kinds: MESSAGE_WINDOW_KINDS, limit: 50 }])
  const hits = events
    .filter((event) => event.content.includes('verification'))
    .map((event) => ({
      event_id: event.id,
      content: event.content,
      kind: event.kind,
      pubkey: event.pubkey,
      channel_id: eventTag(event, 'h'),
      channel_name: null,
      created_at: event.created_at,
      score: 1
    }))
  return { hits, found: hits.length }
}

export async function editMessageWorld(ctx: ScenarioContext): Promise<undefined> {
  await publish(
    MESSAGE_EDIT_KIND,
    VERIFY_EDITED_CONTENT,
    [['h', requiredCtx(ctx.channelId, 'channel id')], ['e', requiredCtx(ctx.eventId, 'event id')]],
    'The relay rejected the action.'
  )
  return undefined
}

export async function addReactionWorld(ctx: ScenarioContext): Promise<undefined> {
  await publish(
    REACTION_KIND,
    VERIFY_REACTION_EMOJI,
    [['e', requiredCtx(ctx.eventId, 'message event id')]],
    'The relay rejected the action.'
  )
  return undefined
}

export async function removeReactionWorld(ctx: ScenarioContext): Promise<undefined> {
  const events = await queryRelay([
    {
      kinds: [REACTION_KIND],
      '#e': [requiredCtx(ctx.eventId, 'message event id')],
      authors: [signerPubkey()],
      limit: 100
    }
  ])
  const reaction = events.find((event) => event.content === VERIFY_REACTION_EMOJI)
  if (reaction) {
    await publish(DELETION_KIND, '', [['e', reaction.id]], 'The relay rejected the action.')
  }
  return undefined
}

export async function deleteMessageWorld(ctx: ScenarioContext): Promise<undefined> {
  await publish(
    BUZZ_DELETE_MESSAGE_KIND,
    '',
    [
      ['h', requiredCtx(ctx.channelId, 'channel id')],
      ['e', requiredCtx(ctx.eventId, 'message event id')]
    ],
    'The relay rejected the action.'
  )
  return undefined
}

// ── profiles (kind 0) ───────────────────────────────────────────────────────

export type ProfileView = {
  pubkey: string
  display_name: string | null
  about: string | null
  has_profile_event: boolean
}

function profileFromContent(event: RelayQueriedEvent | undefined, pubkey: string): ProfileView {
  if (!event) {
    return { pubkey, display_name: null, about: null, has_profile_event: false }
  }
  let content: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(event.content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      content = parsed
    }
  } catch {
    // A malformed historical profile must not strand the settings surface.
  }
  const text = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value : null
  return {
    pubkey,
    display_name: text(content.display_name) ?? text(content.name),
    about: text(content.about),
    has_profile_event: true
  }
}

async function newestOwnProfile(): Promise<ProfileView> {
  const self = signerPubkey()
  const events = await queryRelay([{ kinds: [PROFILE_KIND], authors: [self], limit: 1 }])
  return profileFromContent(newestFirst(events)[0], self)
}

export async function updateProfileWorld(): Promise<ProfileView> {
  const content = JSON.stringify({ display_name: VERIFY_PROFILE_NAME, about: VERIFY_PROFILE_ABOUT })
  await publish(PROFILE_KIND, content, [], 'The relay rejected the profile update.')
  return {
    pubkey: signerPubkey(),
    display_name: VERIFY_PROFILE_NAME,
    about: VERIFY_PROFILE_ABOUT,
    has_profile_event: true
  }
}

export async function getProfileWorld(): Promise<ProfileView> {
  return newestOwnProfile()
}

export async function getUserProfileWorld(): Promise<ProfileView> {
  // Targets the actual signer on purpose: ctx.selfPubkey belongs to the
  // retired renderer-localStorage identity and no longer authors anything.
  return newestOwnProfile()
}

export async function getUsersBatchWorld(): Promise<{
  profiles: Record<string, ProfileView>
  missing: string[]
}> {
  // Batch over the actual signer, not ctx.selfPubkey — see getUserProfileWorld.
  const pubkeys = [participantPubkey()]
  const events = await queryRelay([{ kinds: [PROFILE_KIND], authors: pubkeys, limit: pubkeys.length }])
  const profiles: Record<string, ProfileView> = {}
  const missing: string[] = []
  for (const pubkey of pubkeys) {
    const event = newestFirst(events).find((candidate) => candidate.pubkey === pubkey)
    if (!event) {
      missing.push(pubkey)
      continue
    }
    profiles[pubkey] = profileFromContent(event, pubkey)
  }
  return { profiles, missing }
}

export async function searchUsersWorld(): Promise<{ users: (ProfileView & { is_agent: boolean })[]; next_cursor: null }> {
  const events = await queryRelay([{ kinds: [PROFILE_KIND], authors: [signerPubkey()], limit: 8 }])
  const users = newestFirst(events)
    .map((event) => profileFromContent(event, event.pubkey))
    .filter((profile) => (profile.display_name ?? '').includes('Verify'))
    .map((profile) => ({ ...profile, is_agent: false }))
  return { users, next_cursor: null }
}

/**
 * Home-feed projection over mention-tagged channel messages ("#p" carries
 * the mentioned pubkey), with channel names joined from kind-39000
 * metadata — the vendored loadRelayFeed's shape against this relay.
 */
export async function feedWorldSnapshot(): Promise<unknown> {
  const self = signerPubkey()
  const events = await queryRelay([{ kinds: MESSAGE_WINDOW_KINDS, '#p': [self], limit: 50 }])
  const channelIds = [
    ...new Set(events.map((event) => eventTag(event, 'h')).filter((id): id is string => Boolean(id)))
  ]
  const metadata = channelIds.length
    ? await queryRelay([{ kinds: [CHANNEL_METADATA_KIND], '#d': channelIds, limit: channelIds.length }])
    : []
  const channelNames = new Map(
    newestFirst(metadata).map((event) => [eventTag(event, 'd'), eventTag(event, 'name') ?? ''])
  )
  const mentions = events.map((event) => {
    const channelId = eventTag(event, 'h')
    return {
      ...event,
      channel_id: channelId,
      channel_name: channelId ? channelNames.get(channelId) ?? '' : '',
      channel_type: null,
      category: 'mention'
    }
  })
  const now = Math.floor(Date.now() / 1000)
  return {
    feed: { mentions, needs_action: [], activity: [], agent_activity: [] },
    meta: { since: now - 7 * 86400, total: mentions.length, generated_at: now }
  }
}

// ── DM provisioning (kind 41010 → relay-side kind 39000) ────────────────────
/**
 * The DM view is built by hand rather than through channelDetail: the relay
 * provisions DM metadata without a "t" tag (relay-dm.ts), so the generic
 * mapper would misreport the channel type as "stream".
 */
export async function openDmWorld(ctx: ScenarioContext): Promise<ChannelDetailView> {
  const other = ctx.otherPubkey.toLowerCase()
  if (other === signerPubkey().toLowerCase()) {
    throw new Error('Select at least one person to start a DM.')
  }
  const submission = await submitRelayEventWithResponse(
    signParticipantEvent({ kind: DM_OPEN_KIND, content: '', tags: [['p', other]] })
  )
  const responsePayload =
    typeof submission.message === 'string' && submission.message.startsWith('response:')
      ? (JSON.parse(submission.message.slice('response:'.length)) as Record<string, unknown>)
      : {}
  const channelId = responsePayload.channel_id
  if (typeof channelId !== 'string' || !channelId) {
    throw new Error('DM channel id missing from relay response')
  }
  const [metadata] = await queryRelay([{ kinds: [CHANNEL_METADATA_KIND], '#d': [channelId], limit: 1 }])
  const participants = metadata
    ? metadata.tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1])
    : [signerPubkey(), other]
  return {
    id: channelId,
    name: metadata ? eventTag(metadata, 'name') ?? 'DM' : 'DM',
    description: metadata ? eventTag(metadata, 'about') ?? '' : '',
    channel_type: 'dm',
    visibility: 'private',
    topic: null,
    purpose: null,
    member_count: participants.length,
    member_pubkeys: participants,
    archived_at: null,
    is_member: true,
    created_by: metadata?.pubkey ?? ''
  }
}
