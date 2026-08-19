import { describe, expect, it } from 'vitest'

import { forumReplyLinkageFromTags, summarizeForumReplies } from './forum-thread-projection'

describe('forumReplyLinkageFromTags', () => {
  it('reports depth 0 with no linkage for a root-level post (happy path)', () => {
    expect(forumReplyLinkageFromTags([['h', 'channel-1']])).toEqual({ parentEventId: null, rootEventId: null, depth: 0 })
  })

  it('reports depth 1 for a direct reply to the root', () => {
    const linkage = forumReplyLinkageFromTags([['e', 'root-1', '', 'root']])
    expect(linkage).toEqual({ parentEventId: 'root-1', rootEventId: 'root-1', depth: 1 })
  })

  it('reports depth 2 for a reply to a reply (root and reply tags differ)', () => {
    const linkage = forumReplyLinkageFromTags([
      ['e', 'root-1', '', 'root'],
      ['e', 'reply-5', '', 'reply']
    ])
    expect(linkage).toEqual({ parentEventId: 'reply-5', rootEventId: 'root-1', depth: 2 })
  })

  it('ignores e tags without a recognized marker (failure path: unmarked mention tags)', () => {
    expect(forumReplyLinkageFromTags([['e', 'some-other-event']])).toEqual({ parentEventId: null, rootEventId: null, depth: 0 })
  })
})

describe('summarizeForumReplies', () => {
  it('summarizes reply count, last reply time, and unique participants (happy path)', () => {
    const summary = summarizeForumReplies([
      { pubkey: 'alice', created_at: 100 },
      { pubkey: 'bob', created_at: 300 },
      { pubkey: 'alice', created_at: 200 }
    ])
    expect(summary).toEqual({ replyCount: 3, descendantCount: 3, lastReplyAt: 300, participants: ['alice', 'bob'] })
  })

  it('returns null for an unanswered post rather than a zeroed-out summary (failure path)', () => {
    expect(summarizeForumReplies([])).toBeNull()
  })
})
