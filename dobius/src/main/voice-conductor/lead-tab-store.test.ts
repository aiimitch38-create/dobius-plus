import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLeadTabStore } from './lead-tab-store'

describe('voice conductor lead-tab store', () => {
  it('persists and reloads a lead tab by normalized project path', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dobius-lead-tabs-'))
    const filePath = path.join(root, 'lead-tabs.json')
    const store = createLeadTabStore(filePath)

    store.set(path.join(root, 'repo', '..', 'repo'), 'terminal-handle-1')

    expect(createLeadTabStore(filePath).get(path.join(root, 'repo'))).toBe('terminal-handle-1')
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toMatchObject({ version: 1 })
  })

  it('clears a saved lead tab', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dobius-lead-tabs-'))
    const filePath = path.join(root, 'lead-tabs.json')
    const store = createLeadTabStore(filePath)
    store.set('/repo', 'terminal-handle-1')

    store.set('/repo', null)

    expect(createLeadTabStore(filePath).get('/repo')).toBeNull()
  })

  it('rejects control characters in persisted identifiers', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dobius-lead-tabs-'))
    const store = createLeadTabStore(path.join(root, 'lead-tabs.json'))

    expect(() => store.set('/repo', 'terminal\u0000handle')).toThrow('tabId malformed')
    expect(() => store.get('/repo\u0000bad')).toThrow('projectPath required')
  })

  it('keeps an unreadable file and refuses to save over it', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dobius-lead-tabs-'))
    const filePath = path.join(root, 'lead-tabs.json')
    const original = '{"version":1,"leadTabIdByProjectPath":{"/repo":"term'
    writeFileSync(filePath, original)
    const store = createLeadTabStore(filePath)

    expect(store.get('/repo')).toBeNull()
    expect(() => store.set('/other', 'terminal-handle-2')).toThrow("can't be read")

    expect(readFileSync(filePath, 'utf8')).toBe(original)
    expect(readdirSync(root).some((name) => name.startsWith('lead-tabs.json.unreadable-'))).toBe(true)
  })

  it('treats one malformed entry as an unreadable file, not a dropped row', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'dobius-lead-tabs-'))
    const filePath = path.join(root, 'lead-tabs.json')
    const original = JSON.stringify({ version: 1, leadTabIdByProjectPath: { '/a': 'term-1', '/b': 42 } })
    writeFileSync(filePath, original)

    expect(() => createLeadTabStore(filePath).set('/c', 'term-3')).toThrow("can't be read")
    expect(readFileSync(filePath, 'utf8')).toBe(original)
  })
})
