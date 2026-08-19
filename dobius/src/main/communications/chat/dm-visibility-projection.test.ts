import { describe, expect, it } from 'vitest'

import { buildHiddenDmSnapshotTags, hiddenDmChannelIdsFromTags } from './dm-visibility-projection'

describe('hiddenDmChannelIdsFromTags', () => {
  it('reads every h tag value (happy path)', () => {
    expect(
      hiddenDmChannelIdsFromTags([
        ['p', 'self'],
        ['h', 'dm-1'],
        ['h', 'dm-2']
      ])
    ).toEqual(['dm-1', 'dm-2'])
  })

  it('returns an empty list when nothing is hidden yet (failure path: first hide_dm ever)', () => {
    expect(hiddenDmChannelIdsFromTags([['p', 'self']])).toEqual([])
  })
})

describe('buildHiddenDmSnapshotTags', () => {
  it('keeps previously hidden DMs and adds the new one, sorted, with a self p tag first (happy path)', () => {
    const tags = buildHiddenDmSnapshotTags('SELF', [
      ['p', 'self'],
      ['h', 'dm-2']
    ], 'dm-1')
    expect(tags).toEqual([
      ['p', 'self'],
      ['h', 'dm-1'],
      ['h', 'dm-2']
    ])
  })

  it('is idempotent: hiding an already-hidden DM does not duplicate it (failure path: repeat call)', () => {
    const tags = buildHiddenDmSnapshotTags('self', [
      ['p', 'self'],
      ['h', 'dm-1']
    ], 'dm-1')
    expect(tags).toEqual([
      ['p', 'self'],
      ['h', 'dm-1']
    ])
  })

  it('starts a fresh snapshot when no prior event exists', () => {
    expect(buildHiddenDmSnapshotTags('self', [], 'dm-1')).toEqual([
      ['p', 'self'],
      ['h', 'dm-1']
    ])
  })
})
