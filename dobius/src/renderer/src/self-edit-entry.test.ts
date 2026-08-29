import { describe, expect, it } from 'vitest'
import { parseSelfEditHash } from './self-edit-entry'

describe('parseSelfEditHash', () => {
  it('matches the review window hash', () => {
    expect(parseSelfEditHash('#/self-edit')).toEqual({ kind: 'self-edit' })
    expect(parseSelfEditHash('/self-edit')).toEqual({ kind: 'self-edit' })
    expect(parseSelfEditHash('#/self-edit/')).toEqual({ kind: 'self-edit' })
  })

  it('ignores other routes', () => {
    expect(parseSelfEditHash('#/orb')).toBeNull()
    expect(parseSelfEditHash('')).toBeNull()
  })
})
