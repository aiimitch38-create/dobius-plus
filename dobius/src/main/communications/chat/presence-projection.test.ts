import { describe, expect, it } from 'vitest'

import { presenceStatusFromLastSeen } from './presence-projection'

describe('presenceStatusFromLastSeen', () => {
  it('reports online within the online window (happy path)', () => {
    expect(presenceStatusFromLastSeen(1_000, 1_200)).toBe('online')
  })

  it('reports away between the online and away windows', () => {
    expect(presenceStatusFromLastSeen(1_000, 1_000 + 20 * 60)).toBe('away')
  })

  it('reports offline once past the away window', () => {
    expect(presenceStatusFromLastSeen(1_000, 1_000 + 60 * 60)).toBe('offline')
  })

  it('reports offline with no prior activity at all (failure path: unknown pubkey)', () => {
    expect(presenceStatusFromLastSeen(null, 1_000)).toBe('offline')
  })

  it('treats the online-window boundary as inclusive', () => {
    expect(presenceStatusFromLastSeen(1_000, 1_000 + 5 * 60)).toBe('online')
  })
})
