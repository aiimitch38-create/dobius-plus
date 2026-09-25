import { describe, expect, it } from 'vitest'
import { classifyConnection } from './connection-health'

describe('classifyConnection update-required', () => {
  it('tells the user to update the app, not that auth failed', () => {
    expect(
      classifyConnection({ state: 'update-required', reconnectAttempts: 0, lastConnectedAt: null })
    ).toEqual({ kind: 'update-required', label: 'Update the Dobius+ app' })
  })
})
