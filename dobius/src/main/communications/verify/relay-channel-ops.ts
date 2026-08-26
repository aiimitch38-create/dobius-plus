/**
 * Channel world operations for CORE's verification-gate scenarios:
 * metadata, membership, listing/detail views, and the teardown family
 * (archive/unarchive/join/leave/delete). Every event is signed through the
 * shared wire primitives in relay-world-wire.ts; see relay-world-ops.ts's
 * header for the direct-step contract and the identity-split rationale.
 */
import { randomUUID } from 'node:crypto'
import type { ScenarioContext } from '../scenario-contract'
import type { RelayQueriedEvent } from '../identity/relay-http-client'
import { CHANNEL_MEMBERSHIP_KIND, CHANNEL_METADATA_KIND, DELETION_KIND, eventTag, newestFirst, publish, queryRelay, requiredCtx, signerPubkey } from './relay-world-wire'

export const VERIFY_CHANNEL_NAME = 'Verify Channel'

// ── channel metadata / membership ───────────────────────────────────────────

function channelMetadataTags(tags: {
  channelId: string
  name: string
  description?: string | null
  channelType?: string
  topic?: string | null
  purpose?: string | null
  visibility?: string
  archived?: boolean
}): string[][] {
  const built: string[][] = [
    ['d', tags.channelId],
    ['name', tags.name],
    ['t', tags.channelType ?? 'stream']
  ]
  if (tags.description) {built.push(['about', tags.description])}
  if (tags.topic) {built.push(['topic', tags.topic])}
  if (tags.purpose) {built.push(['purpose', tags.purpose])}
  if (tags.visibility === 'private') {built.push(['private', 'true'])}
  if (tags.archived) {built.push(['archived', 'true'])}
  return built
}

async function latestChannelEvent(kind: number, channelId: string): Promise<RelayQueriedEvent | null> {
  const events = await queryRelay([{ kinds: [kind], '#d': [channelId], limit: 20 }])
  return newestFirst(events)[0] ?? null
}

async function channelMembership(channelId: string): Promise<Map<string, string>> {
  const latest = await latestChannelEvent(CHANNEL_MEMBERSHIP_KIND, channelId)
  const members = new Map<string, string>()
  for (const tag of latest?.tags ?? []) {
    if (tag[0] === 'p' && typeof tag[1] === 'string') {
      members.set(tag[1].toLowerCase(), tag[2] ?? 'member')
    }
  }
  return members
}

async function publishChannelMembership(channelId: string, members: Map<string, string>): Promise<void> {
  const tags: string[][] = [['d', channelId]]
  for (const [memberPubkey, role] of members) {
    tags.push(['p', memberPubkey, role])
  }
  await publish(
    CHANNEL_MEMBERSHIP_KIND,
    '',
    tags,
    'The relay rejected the membership update.'
  )
}

export type ChannelDetailView = {
  id: string
  name: string
  description: string
  channel_type: string
  visibility: 'open' | 'private'
  topic: string | null
  purpose: string | null
  member_count: number
  member_pubkeys: string[]
  archived_at: string | null
  is_member: boolean
  created_by: string
}

async function channelDetail(channelId: string): Promise<ChannelDetailView> {
  const [metadata, members] = await Promise.all([
    latestChannelEvent(CHANNEL_METADATA_KIND, channelId),
    channelMembership(channelId)
  ])
  if (!metadata) {
    throw new Error(`Channel not found: ${channelId}`)
  }
  const memberPubkeys = [...members.keys()]
  const archivedAt = metadata.tags.some((tag) => tag[0] === 'archived' && tag[1] === 'true')
    ? new Date(metadata.created_at * 1000).toISOString()
    : null
  return {
    id: eventTag(metadata, 'd') ?? '',
    name: eventTag(metadata, 'name') ?? '',
    description: eventTag(metadata, 'about') ?? '',
    channel_type: eventTag(metadata, 't') ?? 'stream',
    visibility: metadata.tags.some((tag) => tag[0] === 'private') ? 'private' : 'open',
    topic: eventTag(metadata, 'topic'),
    purpose: eventTag(metadata, 'purpose'),
    member_count: memberPubkeys.length,
    member_pubkeys: memberPubkeys,
    archived_at: archivedAt,
    is_member: memberPubkeys.includes(signerPubkey().toLowerCase()),
    created_by: metadata.pubkey
  }
}

function slugifyChannelName(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${base || 'channel'}-${randomUUID().slice(0, 8)}`
}

export async function createChannelWorld(): Promise<ChannelDetailView> {
  const channelId = slugifyChannelName(VERIFY_CHANNEL_NAME)
  await publish(
    CHANNEL_METADATA_KIND,
    '',
    channelMetadataTags({ channelId, name: VERIFY_CHANNEL_NAME, channelType: 'stream', visibility: 'open' }),
    'The relay rejected the channel update.'
  )
  const members = new Map<string, string>([[signerPubkey().toLowerCase(), 'owner']])
  await publishChannelMembership(channelId, members)
  return channelDetail(channelId)
}

export async function getChannelsWorld(): Promise<unknown[]> {
  const self = signerPubkey().toLowerCase()
  const [memberships, metadata] = await Promise.all([
    queryRelay([{ kinds: [CHANNEL_MEMBERSHIP_KIND], '#p': [self], limit: 1000 }]),
    queryRelay([{ kinds: [CHANNEL_METADATA_KIND], limit: 200 }])
  ])
  const memberIds = new Set(
    memberships.flatMap((event) => event.tags.filter((tag) => tag[0] === 'd').map((tag) => tag[1]))
  )
  return newestFirst(metadata).map((event) => {
    const id = eventTag(event, 'd') ?? ''
    const membership = memberships.find((candidate) => eventTag(candidate, 'd') === id)
    const participants = (membership?.tags ?? [])
      .filter((tag) => tag[0] === 'p')
      .map((tag) => tag[1])
    return {
      id,
      name: eventTag(event, 'name') ?? '',
      description: eventTag(event, 'about') ?? '',
      channel_type: eventTag(event, 't') ?? 'stream',
      visibility: event.tags.some((tag) => tag[0] === 'private') ? 'private' : 'open',
      archived_at: event.tags.some((tag) => tag[0] === 'archived' && tag[1] === 'true')
        ? new Date(event.created_at * 1000).toISOString()
        : null,
      participants,
      is_member: memberIds.has(id)
    }
  })
}

export async function getChannelDetailsWorld(ctx: ScenarioContext): Promise<ChannelDetailView> {
  return channelDetail(requiredCtx(ctx.channelId, 'channel id'))
}

export async function updateChannelDescriptionWorld(ctx: ScenarioContext): Promise<ChannelDetailView> {
  return republishChannelMetadata(requiredCtx(ctx.channelId, 'channel id'), { description: 'verify description' })
}

export async function setChannelTopicWorld(ctx: ScenarioContext): Promise<undefined> {
  await republishChannelMetadata(requiredCtx(ctx.channelId, 'channel id'), { topic: 'verify-topic' })
  return undefined
}

export async function setChannelPurposeWorld(ctx: ScenarioContext): Promise<undefined> {
  await republishChannelMetadata(requiredCtx(ctx.channelId, 'channel id'), { purpose: 'verify-purpose' })
  return undefined
}

async function republishChannelMetadata(
  channelId: string,
  patch: { description?: string; topic?: string; purpose?: string }
): Promise<ChannelDetailView> {
  const existing = await latestChannelEvent(CHANNEL_METADATA_KIND, channelId)
  if (!existing) {
    throw new Error(`Channel not found: ${channelId}`)
  }
  await publish(
    CHANNEL_METADATA_KIND,
    '',
    channelMetadataTags({
      channelId,
      name: eventTag(existing, 'name') ?? channelId,
      description: patch.description ?? eventTag(existing, 'about'),
      channelType: eventTag(existing, 't') ?? 'stream',
      topic: patch.topic ?? eventTag(existing, 'topic'),
      purpose: patch.purpose ?? eventTag(existing, 'purpose'),
      visibility: existing.tags.some((tag) => tag[0] === 'private') ? 'private' : 'open',
      archived: existing.tags.some((tag) => tag[0] === 'archived' && tag[1] === 'true')
    }),
    'The relay rejected the channel update.'
  )
  return channelDetail(channelId)
}

export type ChannelMembersView = {
  members: { pubkey: string; role: string }[]
  next_cursor: null
}

export async function getChannelMembersWorld(ctx: ScenarioContext): Promise<ChannelMembersView> {
  const channelId = requiredCtx(ctx.channelId, 'channel id')
  const members = await channelMembership(channelId)
  return {
    members: [...members.entries()].map(([memberPubkey, role]) => ({
      pubkey: memberPubkey,
      role
    })),
    next_cursor: null
  }
}

export async function addChannelMembersWorld(ctx: ScenarioContext): Promise<{ added: string[]; errors: string[] }> {
  const channelId = requiredCtx(ctx.channelId, 'channel id')
  const requested = [ctx.otherPubkey.toLowerCase()]
  const members = await channelMembership(channelId)
  for (const pubkey of requested) {
    members.set(pubkey, 'member')
  }
  await publishChannelMembership(channelId, members)
  return { added: requested, errors: [] }
}

export async function changeChannelMemberRoleWorld(ctx: ScenarioContext): Promise<undefined> {
  const channelId = requiredCtx(ctx.channelId, 'channel id')
  const target = ctx.otherPubkey.toLowerCase()
  const members = await channelMembership(channelId)
  if (!members.has(target)) {
    throw new Error(`${target} is not a member of channel ${channelId}`)
  }
  members.set(target, 'admin')
  await publishChannelMembership(channelId, members)
  return undefined
}

export async function removeChannelMemberWorld(ctx: ScenarioContext): Promise<undefined> {
  const channelId = requiredCtx(ctx.channelId, 'channel id')
  const members = await channelMembership(channelId)
  members.delete(ctx.otherPubkey.toLowerCase())
  await publishChannelMembership(channelId, members)
  return undefined
}

export async function ensureStarterChannelsWorld(): Promise<unknown[]> {
  const channels = (await getChannelsWorld()) as Record<string, unknown>[]
  if (!channels.some((channel) => channel.id === 'general')) {
    await publish(
      CHANNEL_METADATA_KIND,
      '',
      channelMetadataTags({ channelId: 'general', name: 'general' }),
      'The relay rejected the channel update.'
    )
    await publishChannelMembership('general', new Map([[signerPubkey().toLowerCase(), 'owner']]))
    return getChannelsWorld()
  }
  return channels
}

// ── teardown: archive/unarchive/join/leave/delete ───────────────────────────

export async function archiveChannelWorld(ctx: ScenarioContext): Promise<undefined> {
  await setChannelArchived(requiredCtx(ctx.channelId, 'channel id'), true)
  return undefined
}

export async function unarchiveChannelWorld(ctx: ScenarioContext): Promise<undefined> {
  await setChannelArchived(requiredCtx(ctx.channelId, 'channel id'), false)
  return undefined
}

async function setChannelArchived(channelId: string, archived: boolean): Promise<void> {
  const existing = await latestChannelEvent(CHANNEL_METADATA_KIND, channelId)
  if (!existing) {
    throw new Error(`Channel not found: ${channelId}`)
  }
  await publish(
    CHANNEL_METADATA_KIND,
    '',
    channelMetadataTags({
      channelId,
      name: eventTag(existing, 'name') ?? channelId,
      description: eventTag(existing, 'about'),
      channelType: eventTag(existing, 't') ?? 'stream',
      topic: eventTag(existing, 'topic'),
      purpose: eventTag(existing, 'purpose'),
      visibility: existing.tags.some((tag) => tag[0] === 'private') ? 'private' : 'open',
      archived
    }),
    'The relay rejected the channel update.'
  )
}

export async function joinChannelWorld(ctx: ScenarioContext): Promise<undefined> {
  const channelId = requiredCtx(ctx.channelId, 'channel id')
  const members = await channelMembership(channelId)
  members.set(signerPubkey().toLowerCase(), 'member')
  await publishChannelMembership(channelId, members)
  return undefined
}

export async function leaveChannelWorld(ctx: ScenarioContext): Promise<undefined> {
  const channelId = requiredCtx(ctx.channelId, 'channel id')
  const members = await channelMembership(channelId)
  members.delete(signerPubkey().toLowerCase())
  await publishChannelMembership(channelId, members)
  return undefined
}

export async function deleteChannelWorld(ctx: ScenarioContext): Promise<undefined> {
  const channelId = requiredCtx(ctx.channelId, 'channel id')
  const metadata = await latestChannelEvent(CHANNEL_METADATA_KIND, channelId)
  if (!metadata) {
    throw new Error(`Channel not found: ${channelId}`)
  }
  // Nostr has no hard delete for addressable events: archive, then publish a
  // NIP-09 request against the coordinate for relays that honor it.
  await setChannelArchived(channelId, true)
  await publish(
    DELETION_KIND,
    '',
    [['a', `${CHANNEL_METADATA_KIND}:${metadata.pubkey}:${channelId}`]],
    'The relay rejected the action.'
  )
  return undefined
}
