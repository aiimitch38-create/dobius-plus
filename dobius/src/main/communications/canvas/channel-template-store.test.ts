import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: channel-template-store keys its file location off Electron's userData
// path, so the electron module is mocked to point at a per-test temp
// directory — same pattern as team-store.test.ts.
const testState = { dir: '' }

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  }
}))

describe('channel-template-store', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-channel-template-store-'))
    // Why: the store caches its roster in a module-level variable, so each
    // test needs a fresh module instance to avoid leaking state across tests
    // that use different temp directories.
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('creates, lists, updates, and deletes a channel template', async () => {
    const { createChannelTemplate, listChannelTemplates, updateChannelTemplate, removeChannelTemplate } = await import(
      './channel-template-store'
    )

    expect(listChannelTemplates()).toEqual([])

    const afterCreate = createChannelTemplate({
      name: 'Standup',
      description: 'Daily standup channel',
      channelType: 'stream',
      visibility: 'open',
      canvasTemplate: '# Agenda'
    })
    expect(afterCreate).toHaveLength(1)
    const created = afterCreate[0]
    expect(created).toMatchObject({
      name: 'Standup',
      description: 'Daily standup channel',
      channelType: 'stream',
      visibility: 'open',
      canvasTemplate: '# Agenda',
      agents: { personas: [], teams: [] }
    })
    expect(created.id).toBeTruthy()
    expect(created.createdAt).toBeTypeOf('number')

    expect(listChannelTemplates()).toEqual(afterCreate)

    const afterUpdate = updateChannelTemplate(created.id, { name: 'Standup Renamed', visibility: 'private' })
    const updated = afterUpdate.find((template) => template.id === created.id)
    expect(updated).toMatchObject({ name: 'Standup Renamed', visibility: 'private' })
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)

    const afterDelete = removeChannelTemplate(created.id)
    expect(afterDelete).toEqual([])
    expect(listChannelTemplates()).toEqual([])
  })

  it('rejects updating a channel template that does not exist', async () => {
    const { updateChannelTemplate } = await import('./channel-template-store')
    expect(() => updateChannelTemplate('ghost', { name: 'X' })).toThrow('Channel template not found')
  })

  it('rejects a blank template name on create and update', async () => {
    const { createChannelTemplate, updateChannelTemplate } = await import('./channel-template-store')
    expect(() => createChannelTemplate({ name: '   ' })).toThrow('Channel template name is required')

    const [template] = createChannelTemplate({ name: 'Valid Template' })
    expect(() => updateChannelTemplate(template.id, { name: '  ' })).toThrow('Channel template name is required')
  })

  it('falls back to safe defaults for an invalid channelType/visibility', async () => {
    const { createChannelTemplate } = await import('./channel-template-store')
    const [template] = createChannelTemplate({ name: 'Weird', channelType: 'not-a-real-type', visibility: 'also-fake' })
    expect(template.channelType).toBe('stream')
    expect(template.visibility).toBe('open')
  })

  it('drops persona/team entries with no id but keeps well-formed ones, without validating against another store', async () => {
    const { createChannelTemplate } = await import('./channel-template-store')
    const [template] = createChannelTemplate({
      name: 'Agents Preset',
      agents: {
        personas: [{ personaId: 'persona-does-not-exist' }, { personaId: '' }, {}],
        teams: [{ teamId: 'team-1', backend: { type: 'local' } }, { teamId: '' }]
      }
    })
    expect(template.agents.personas).toEqual([
      { personaId: 'persona-does-not-exist', runtime: null, model: null, role: null, backend: null }
    ])
    expect(template.agents.teams).toEqual([{ teamId: 'team-1', runtime: null, model: null, backend: { type: 'local' } }])
  })

  it('duplicates a template under a new id with a suffixed name', async () => {
    const { createChannelTemplate, duplicateChannelTemplate } = await import('./channel-template-store')
    const [original] = createChannelTemplate({ name: 'Original', canvasTemplate: '# Hi' })
    const afterDuplicate = duplicateChannelTemplate(original.id)
    expect(afterDuplicate).toHaveLength(2)
    const copy = afterDuplicate.find((template) => template.id !== original.id)!
    expect(copy.name).toBe('Original (Copy)')
    expect(copy.canvasTemplate).toBe('# Hi')
    expect(copy.id).not.toBe(original.id)
  })

  it('rejects duplicating a channel template that does not exist', async () => {
    const { duplicateChannelTemplate } = await import('./channel-template-store')
    expect(() => duplicateChannelTemplate('ghost')).toThrow('Channel template not found')
  })

  it('persists channel templates to disk across a fresh module load', async () => {
    const first = await import('./channel-template-store')
    const [template] = first.createChannelTemplate({ name: 'Durable Template' })

    vi.resetModules()
    const second = await import('./channel-template-store')
    const reloaded = second.listChannelTemplates()
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]).toMatchObject({ id: template.id, name: 'Durable Template' })
  })

  // Security: a template name is stored as one row inside a single JSON
  // array file, never used to build a per-record file path — a path
  // traversal or shell-metacharacter payload in the name must round-trip as
  // inert string data and must not cause any file outside the store's own
  // channel-templates.json to be read, written, or escaped to.
  it('treats a path-traversal-shaped template name as inert data, never a file path', async () => {
    const { createChannelTemplate, listChannelTemplates } = await import('./channel-template-store')
    const maliciousName = '../../evil'
    const [template] = createChannelTemplate({ name: maliciousName, description: '$(rm -rf /)' })
    expect(template.name).toBe(maliciousName)
    expect(listChannelTemplates()[0].name).toBe(maliciousName)

    const filesInStoreDir = readdirSync(testState.dir)
    expect(filesInStoreDir).toEqual(['channel-templates.json'])
    const parentDir = join(testState.dir, '..')
    expect(readdirSync(parentDir)).not.toContain('evil')
  })
})
