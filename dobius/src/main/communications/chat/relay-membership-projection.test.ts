import { describe, expect, it } from 'vitest'

import { bootstrapOwnerMember, buildRelayAdminEventTags, relayMembersFromSnapshotTags } from './relay-membership-projection'

const PUBKEY_A = 'a'.repeat(64)
const PUBKEY_B = 'b'.repeat(64)

describe('relayMembersFromSnapshotTags', () => {
  it('reads member tags with an explicit role (happy path)', () => {
    const members = relayMembersFromSnapshotTags([['member', PUBKEY_A, 'owner']], '2026-01-01T00:00:00.000Z')
    expect(members).toEqual([{ pubkey: PUBKEY_A, role: 'owner', addedBy: null, createdAtIso: '2026-01-01T00:00:00.000Z' }])
  })

  it('reads bare p tags with the role in position 3, defaulting to member', () => {
    const members = relayMembersFromSnapshotTags(
      [
        ['p', PUBKEY_A, '', 'admin'],
        ['p', PUBKEY_B]
      ],
      '2026-01-01T00:00:00.000Z'
    )
    expect(members).toEqual([
      { pubkey: PUBKEY_A, role: 'admin', addedBy: null, createdAtIso: '2026-01-01T00:00:00.000Z' },
      { pubkey: PUBKEY_B, role: 'member', addedBy: null, createdAtIso: '2026-01-01T00:00:00.000Z' }
    ])
  })

  it('deduplicates a pubkey that appears twice, keeping the first occurrence', () => {
    const members = relayMembersFromSnapshotTags(
      [
        ['member', PUBKEY_A, 'owner'],
        ['member', PUBKEY_A, 'member']
      ],
      '2026-01-01T00:00:00.000Z'
    )
    expect(members).toHaveLength(1)
    expect(members[0].role).toBe('owner')
  })

  it('ignores malformed rows: unrelated tag names and non-hex pubkeys (failure path)', () => {
    const members = relayMembersFromSnapshotTags(
      [
        ['d', 'some-channel'],
        ['member', 'not-a-real-pubkey', 'owner']
      ],
      '2026-01-01T00:00:00.000Z'
    )
    expect(members).toEqual([])
  })

  it('returns an empty list for an empty snapshot (failure path: no members recorded)', () => {
    expect(relayMembersFromSnapshotTags([], '2026-01-01T00:00:00.000Z')).toEqual([])
  })
})

describe('buildRelayAdminEventTags', () => {
  it('lowercases and trims the target pubkey, and includes a role tag when given', () => {
    expect(buildRelayAdminEventTags(` ${PUBKEY_A.toUpperCase()} `, 'admin')).toEqual([
      ['p', PUBKEY_A],
      ['role', 'admin']
    ])
  })

  it('omits the role tag when no role is given (e.g. remove_relay_member)', () => {
    expect(buildRelayAdminEventTags(PUBKEY_B)).toEqual([['p', PUBKEY_B]])
  })
})

describe('bootstrapOwnerMember', () => {
  it('reports the local identity as owner (happy path: fresh relay, no snapshot yet)', () => {
    expect(bootstrapOwnerMember(PUBKEY_A, '2026-01-01T00:00:00.000Z')).toEqual({
      pubkey: PUBKEY_A,
      role: 'owner',
      addedBy: null,
      createdAtIso: '2026-01-01T00:00:00.000Z'
    })
  })

  it('lowercases and trims the pubkey (failure path: identity stored with stray case/whitespace)', () => {
    expect(bootstrapOwnerMember(` ${PUBKEY_A.toUpperCase()} `, '2026-01-01T00:00:00.000Z').pubkey).toBe(PUBKEY_A)
  })
})
