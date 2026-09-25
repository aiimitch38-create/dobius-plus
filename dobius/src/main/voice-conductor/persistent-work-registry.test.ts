import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPersistentWorkRegistry } from './persistent-work-registry'

describe('persistent Voice Conductor work registry', () => {
  it('restores tracked work and completion state after restart', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dobius-conductor-work-'))
    const filePath = path.join(root, 'work.json')
    const registry = createPersistentWorkRegistry(filePath)
    registry.track({
      workId: 'wk-1',
      tabId: 'run-1',
      requestId: 'req-1',
      description: 'Review the change'
    })
    registry.markDone('wk-1', 'Passed review')

    expect(createPersistentWorkRegistry(filePath).list()).toMatchObject([
      { workId: 'wk-1', tabId: 'run-1', status: 'done', summary: 'Passed review' }
    ])
  })

  it('ignores malformed persisted rows', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dobius-conductor-work-'))
    const filePath = path.join(root, 'work.json')
    const registry = createPersistentWorkRegistry(filePath)

    expect(registry.list()).toEqual([])
  })

  it('keeps an unreadable file and makes no reservation it cannot save', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dobius-conductor-work-'))
    const filePath = path.join(root, 'work.json')
    const original = '{"version":1,"items":[{"workId":"wk-1"'
    writeFileSync(filePath, original)
    const registry = createPersistentWorkRegistry(filePath)

    expect(() =>
      registry.track({ workId: 'wk-2', tabId: 't', requestId: 'r', description: 'd' })
    ).toThrow("can't be read")

    expect(registry.list()).toEqual([])
    expect(readFileSync(filePath, 'utf8')).toBe(original)
    expect(readdirSync(root).some((name) => name.startsWith('work.json.unreadable-'))).toBe(true)
  })

  it('treats one malformed row as an unreadable file, not a dropped row', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dobius-conductor-work-'))
    const filePath = path.join(root, 'work.json')
    const good = { workId: 'wk-1', tabId: 't', requestId: 'r', description: 'd', startedAt: 1, status: 'done' }
    const original = JSON.stringify({ version: 1, items: [good, { workId: 7 }] })
    writeFileSync(filePath, original)

    expect(() =>
      createPersistentWorkRegistry(filePath).track({ workId: 'wk-2', tabId: 't', requestId: 'r', description: 'd' })
    ).toThrow("can't be read")
    expect(readFileSync(filePath, 'utf8')).toBe(original)
  })

  it('#61 releases a spawned run left running by a restart, and keeps tab work', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dobius-conductor-work-'))
    const filePath = path.join(root, 'work.json')
    const first = createPersistentWorkRegistry(filePath)
    first.track({ workId: 'spawn-1', tabId: 'agent:a', requestId: 'spawn', description: 'x', kind: 'spawn' })

    const reloaded = createPersistentWorkRegistry(filePath)

    expect(reloaded.list()).toMatchObject([
      { workId: 'spawn-1', kind: 'spawn', status: 'error', summary: expect.stringContaining('restarted') }
    ])
    expect(reloaded.capacityError()).toBeNull()

    reloaded.markDone('spawn-1', 'x', 'error')
    reloaded.track({ workId: 'wk-tab', tabId: 't', requestId: 'r', description: 'tab work' })
    expect(createPersistentWorkRegistry(filePath).list().find((i) => i.workId === 'wk-tab')?.status).toBe('running')
  })
})
