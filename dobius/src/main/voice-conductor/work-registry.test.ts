import { describe, it, expect } from 'vitest'
import { createWorkRegistry } from './work-registry'

describe('createWorkRegistry', () => {
  it('track then list stores a running item with the given fields', () => {
    const reg = createWorkRegistry()
    reg.track({ workId: 'wk-abc12', tabId: 'term-slimject-1', requestId: 'req-1', description: 'brain agent thing' })

    const all = reg.list()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      workId: 'wk-abc12',
      tabId: 'term-slimject-1',
      requestId: 'req-1',
      description: 'brain agent thing',
      status: 'running',
    })
    expect(typeof all[0].startedAt).toBe('number')
    expect(all[0].summary).toBeUndefined()
  })

  it('track with an existing workId replaces the prior entry', () => {
    const reg = createWorkRegistry()
    reg.track({ workId: 'wk-1', tabId: 'term-a-1', requestId: 'r1', description: 'first' })
    reg.track({ workId: 'wk-1', tabId: 'term-b-2', requestId: 'r2', description: 'second' })

    expect(reg.list()).toHaveLength(1)
    expect(reg.list()[0].description).toBe('second')
  })

  it('status() with no target returns everything', () => {
    const reg = createWorkRegistry()
    reg.track({ workId: 'wk-1', tabId: 'term-a-1', requestId: 'r1', description: 'alpha' })
    reg.markDone('wk-1', 'ok')
    reg.track({ workId: 'wk-2', tabId: 'term-b-2', requestId: 'r2', description: 'beta' })

    expect(reg.status()).toHaveLength(2)
  })

  it('status(target) fuzzy-matches workId, tabId, and description case-insensitively', () => {
    const reg = createWorkRegistry()
    reg.track({ workId: 'wk-abc12', tabId: 'term-slimject-1', requestId: 'r1', description: 'fix the checkout bug' })
    reg.markDone('wk-abc12', 'ok')
    reg.track({ workId: 'wk-def34', tabId: 'term-axiom-2', requestId: 'r2', description: 'update routing table' })

    // description substring, mixed case
    expect(reg.status('CHECKOUT').map((e) => e.workId)).toEqual(['wk-abc12'])
    // tabId substring
    expect(reg.status('axiom').map((e) => e.workId)).toEqual(['wk-def34'])
    // workId substring
    expect(reg.status('abc12').map((e) => e.workId)).toEqual(['wk-abc12'])
  })

  it('status(target) returns empty when nothing matches', () => {
    const reg = createWorkRegistry()
    reg.track({ workId: 'wk-1', tabId: 'term-a-1', requestId: 'r1', description: 'alpha' })

    expect(reg.status('nonexistent')).toEqual([])
  })

  it('markDone updates summary and status, returns the item', () => {
    const reg = createWorkRegistry()
    reg.track({ workId: 'wk-1', tabId: 'term-a-1', requestId: 'r1', description: 'alpha' })

    const updated = reg.markDone('wk-1', 'all green')
    expect(updated).not.toBeNull()
    expect(updated).toMatchObject({ workId: 'wk-1', summary: 'all green', status: 'done' })
    expect(reg.list()[0].status).toBe('done')
  })

  it('markDone accepts an error status', () => {
    const reg = createWorkRegistry()
    reg.track({ workId: 'wk-1', tabId: 'term-a-1', requestId: 'r1', description: 'alpha' })

    const updated = reg.markDone('wk-1', 'build failed', 'error')
    expect(updated?.status).toBe('error')
    expect(updated?.summary).toBe('build failed')
  })

  it('markDone returns null for an unknown workId', () => {
    const reg = createWorkRegistry()
    expect(reg.markDone('wk-missing', 'whatever')).toBeNull()
  })

  it('#61 refuses a second running item and admits one after the first ends', () => {
    const reg = createWorkRegistry()
    expect(reg.track({ workId: 'wk-1', tabId: 't1', requestId: 'r1', description: 'one' })).toEqual({ ok: true })

    expect(reg.capacityError()).toBe('concurrency cap: 1/1 agents already running')
    expect(reg.track({ workId: 'wk-2', tabId: 't2', requestId: 'r2', description: 'two' })).toEqual({
      ok: false,
      error: 'concurrency cap: 1/1 agents already running',
      retryable: true
    })
    // Re-tracking the running item is an update, not a second item.
    expect(reg.track({ workId: 'wk-1', tabId: 't1', requestId: 'r1', description: 'one again' }).ok).toBe(true)

    reg.markDone('wk-1', 'failed', 'error')
    expect(reg.capacityError()).toBeNull()
    expect(reg.track({ workId: 'wk-2', tabId: 't2', requestId: 'r2', description: 'two' }).ok).toBe(true)
  })

  it('#61 makes no reservation when it cannot be saved', () => {
    const reg = createWorkRegistry({
      onChange: () => {
        throw new Error('work.json could not be saved')
      }
    })

    expect(() => reg.track({ workId: 'wk-1', tabId: 't1', requestId: 'r1', description: 'one' })).toThrow(
      'could not be saved'
    )
    expect(reg.list()).toEqual([])
    expect(reg.capacityError()).toBeNull()
  })
})
