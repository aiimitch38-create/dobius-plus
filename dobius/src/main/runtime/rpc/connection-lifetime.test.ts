import { describe, expect, it } from 'vitest'
import { RpcConnectionLifetimeRegistry } from './connection-lifetime'

describe('RPC connection lifetime signals', () => {
  it('aborts only when the owning connection ends and rotates on replacement', () => {
    const registry = new RpcConnectionLifetimeRegistry<object>()
    const connection = {}
    const first = registry.open(connection)
    expect(first.aborted).toBe(false)
    expect(registry.signal(connection)).toBe(first)

    const replacement = registry.open(connection)
    expect(first.aborted).toBe(true)
    expect(replacement.aborted).toBe(false)
    expect(registry.size).toBe(1)

    registry.end(connection)
    expect(replacement.aborted).toBe(true)
    expect(registry.size).toBe(0)
  })

  it('aborts all outstanding connection identities at transport shutdown', () => {
    const registry = new RpcConnectionLifetimeRegistry<object>()
    const first = registry.open({})
    const second = registry.open({})
    registry.closeAll()
    expect(first.aborted).toBe(true)
    expect(second.aborted).toBe(true)
    expect(registry.size).toBe(0)
  })
})
