// Native port of the message-window slice of dobiusCommunications.ts, scoped
// to plain 1:1 DM messages (kind 9), their edits (kind 40003) and deletes
// (kind 9005) — reactions/threads are explicitly cut for this pass per
// plans/PORT-buzz-inbox-SPEC.md.
import { getOwnPubkey, publishAsAgent, publishAsSelf, queryRelay, type RelayEventRecord } from './relay-client'

const MESSAGE_KIND = 9
const EDIT_KIND = 40003
const DELETE_KIND = 9005
/** Same window as Buzz's messageGrouping.ts: consecutive same-author messages
 *  within 10 minutes collapse into one visual group (no repeated avatar/header). */
const GROUPING_WINDOW_SECONDS = 10 * 60

export type ThreadMessage = {
  id: string
  pubkey: string
  content: string
  createdAt: number
  edited: boolean
  /** True while optimistically shown before the relay confirms it. */
  pending?: boolean
}

function eventTag(event: RelayEventRecord, name: string): string | null {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? null
}

/** Loads a channel's message history, newest edits applied, deletes removed, oldest-first. */
export async function loadChannelMessages(channelId: string, limit = 100): Promise<ThreadMessage[]> {
  const events = await queryRelay([
    { kinds: [MESSAGE_KIND, EDIT_KIND, DELETE_KIND], '#h': [channelId], limit: limit * 3 }
  ])

  const deletedIds = new Set(
    events.filter((event) => event.kind === DELETE_KIND).map((event) => eventTag(event, 'e')).filter(Boolean)
  )
  const latestEditByTarget = new Map<string, RelayEventRecord>()
  for (const event of events.filter((event) => event.kind === EDIT_KIND)) {
    const targetId = eventTag(event, 'e')
    if (!targetId) {continue}
    const existing = latestEditByTarget.get(targetId)
    if (!existing || event.created_at > existing.created_at) {latestEditByTarget.set(targetId, event)}
  }

  const messages = events
    .filter((event) => event.kind === MESSAGE_KIND && !deletedIds.has(event.id))
    .map((event) => {
      const edit = latestEditByTarget.get(event.id)
      return {
        id: event.id,
        pubkey: event.pubkey,
        content: edit ? edit.content : event.content,
        createdAt: event.created_at,
        edited: Boolean(edit)
      }
    })
    .sort((a, b) => a.createdAt - b.createdAt)

  return messages.slice(-limit)
}

/** Same-author + gap <= 10min => this message is a "continuation" of the previous one. */
export function isContinuation(previous: ThreadMessage | undefined, message: ThreadMessage): boolean {
  if (!previous) {return false}
  return (
    previous.pubkey === message.pubkey &&
    message.createdAt - previous.createdAt <= GROUPING_WINDOW_SECONDS
  )
}

export async function sendDmMessage(channelId: string, content: string): Promise<string> {
  const submission = await publishAsSelf({
    kind: MESSAGE_KIND,
    content,
    tags: [['h', channelId]]
  })
  if (submission.accepted === false || !submission.event_id) {
    throw new Error(submission.message || 'The relay rejected the message.')
  }
  return submission.event_id
}

export async function sendAgentReply(
  agentId: string,
  channelId: string,
  parentEventId: string,
  content: string
): Promise<void> {
  const selfPubkey = await getOwnPubkey()
  await publishAsAgent(agentId, {
    kind: MESSAGE_KIND,
    content,
    tags: [
      ['h', channelId],
      ['p', selfPubkey],
      ['e', parentEventId, '', 'reply']
    ]
  })
}

export async function editDmMessage(channelId: string, eventId: string, content: string): Promise<void> {
  await publishAsSelf({ kind: EDIT_KIND, content, tags: [['h', channelId], ['e', eventId]] })
}

export async function deleteDmMessage(channelId: string, eventId: string): Promise<void> {
  await publishAsSelf({ kind: DELETE_KIND, content: '', tags: [['h', channelId], ['e', eventId]] })
}
