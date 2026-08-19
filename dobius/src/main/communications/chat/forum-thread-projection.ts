/**
 * Forum post/comment threading (kind 45001 posts, kind 45003 comments).
 *
 * Mirrors the reply-linkage convention `sendDobiusChannelMessage` already
 * writes in vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts:
 * `["e", rootEventId, "", "root"]` + `["e", parentEventId, "", "reply"]`
 * (NIP-10 marker style). Depth is capped at 2 there (root=0, direct reply=1,
 * reply-to-reply=2) because that function only ever writes those two tags —
 * this reader follows the same convention rather than inventing arbitrary
 * nesting depth.
 */

export type ForumReplyLinkage = {
  parentEventId: string | null
  rootEventId: string | null
  depth: number
}

export function forumReplyLinkageFromTags(tags: readonly string[][]): ForumReplyLinkage {
  const rootTag = tags.find((tag) => tag[0] === 'e' && tag[3] === 'root')
  const replyTag = tags.find((tag) => tag[0] === 'e' && tag[3] === 'reply')

  const parentEventId = replyTag?.[1] ?? rootTag?.[1] ?? null
  const rootEventId = rootTag?.[1] ?? replyTag?.[1] ?? null
  const depth = parentEventId ? (rootEventId === parentEventId ? 1 : 2) : 0

  return { parentEventId, rootEventId, depth }
}

export type ForumThreadSummary = {
  replyCount: number
  descendantCount: number
  lastReplyAt: number | null
  participants: string[]
}

/** Null when there are no replies — matches `thread_summary: null` for an unanswered post. */
export function summarizeForumReplies(replies: readonly { pubkey: string; created_at: number }[]): ForumThreadSummary | null {
  if (replies.length === 0) {
    return null
  }

  const participants = [...new Set(replies.map((reply) => reply.pubkey))]
  const lastReplyAt = replies.reduce((max, reply) => Math.max(max, reply.created_at), 0)

  return {
    replyCount: replies.length,
    descendantCount: replies.length,
    lastReplyAt,
    participants
  }
}
