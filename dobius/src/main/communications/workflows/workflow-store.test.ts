import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: same pattern as team-store.test.ts — workflow-store keys its file
// location off Electron's userData path.
const testState = { dir: '' }

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  }
}))

describe('workflow-store', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-workflow-store-'))
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('creates, gets, lists by channel, updates, and deletes a workflow', async () => {
    const {
      createWorkflow,
      getWorkflow,
      listWorkflowsByChannel,
      listWorkflowsByChannels,
      updateWorkflow,
      removeWorkflow
    } = await import('./workflow-store')

    const created = createWorkflow({
      ownerPubkey: 'owner-pubkey',
      channelId: 'chan-1',
      yamlDefinition: 'name: Triage\nsteps:\n  - id: a\n    type: log\n'
    })
    expect(created.name).toBe('Triage')
    expect(created.channelId).toBe('chan-1')
    expect(created.status).toBe('active')
    expect(created.webhookSecret).toMatch(/^[0-9a-f]{48}$/)
    expect(created.steps).toEqual([{ id: 'a', type: 'log', with: {} }])

    expect(getWorkflow(created.id)).toEqual(created)
    expect(listWorkflowsByChannel('chan-1')).toEqual([created])
    expect(listWorkflowsByChannel('chan-2')).toEqual([])
    expect(listWorkflowsByChannels(['chan-2', 'chan-1'])).toEqual([created])

    const updated = updateWorkflow(created.id, {
      yamlDefinition: 'name: Triage v2\nstatus: disabled\nsteps: []'
    })
    expect(updated.name).toBe('Triage v2')
    expect(updated.status).toBe('disabled')
    expect(updated.steps).toEqual([])
    // Why: webhook secret is stable across edits (see workflow-store.ts doc).
    expect(updated.webhookSecret).toBe(created.webhookSecret)
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)

    removeWorkflow(created.id)
    expect(getWorkflow(created.id)).toBeNull()
  })

  it('rejects create with invalid YAML and does not persist anything', async () => {
    const { createWorkflow, listWorkflowsByChannel } = await import('./workflow-store')
    expect(() =>
      createWorkflow({ ownerPubkey: 'owner', channelId: 'chan-1', yamlDefinition: 'steps: [unterminated' })
    ).toThrow(/Invalid YAML/)
    expect(listWorkflowsByChannel('chan-1')).toEqual([])
  })

  it('rejects create without an owner', async () => {
    const { createWorkflow } = await import('./workflow-store')
    expect(() => createWorkflow({ ownerPubkey: '  ', channelId: null, yamlDefinition: 'name: x' })).toThrow(
      /Missing workflow owner/
    )
  })

  it('rejects update for a missing workflow', async () => {
    const { updateWorkflow } = await import('./workflow-store')
    expect(() => updateWorkflow('ghost', { yamlDefinition: 'name: x' })).toThrow(/Workflow not found/)
  })

  it('rejects update with invalid YAML and leaves the stored record untouched', async () => {
    const { createWorkflow, updateWorkflow, getWorkflow } = await import('./workflow-store')
    const created = createWorkflow({ ownerPubkey: 'owner', channelId: null, yamlDefinition: 'name: Original' })
    expect(() => updateWorkflow(created.id, { yamlDefinition: '[not a mapping]' })).toThrow(
      /must be a YAML mapping/
    )
    expect(getWorkflow(created.id)?.name).toBe('Original')
  })

  it('rejects removing a missing workflow', async () => {
    const { removeWorkflow } = await import('./workflow-store')
    expect(() => removeWorkflow('ghost')).toThrow(/Workflow not found/)
  })

  it('persists to disk atomically and reloads across module instances', async () => {
    const mod1 = await import('./workflow-store')
    const created = mod1.createWorkflow({ ownerPubkey: 'owner', channelId: 'chan-1', yamlDefinition: 'name: Persisted' })

    vi.resetModules()
    const mod2 = await import('./workflow-store')
    expect(mod2.getWorkflow(created.id)).toEqual(created)

    const onDisk = JSON.parse(readFileSync(join(testState.dir, 'workflows.json'), 'utf-8'))
    expect(onDisk).toHaveLength(1)
    expect(onDisk[0].id).toBe(created.id)
  })

  it('drops a workflow record whose stored YAML no longer parses (corrupt-on-disk)', async () => {
    const mod1 = await import('./workflow-store')
    const created = mod1.createWorkflow({ ownerPubkey: 'owner', channelId: null, yamlDefinition: 'name: Good' })
    const filePath = join(testState.dir, 'workflows.json')
    const onDisk = JSON.parse(readFileSync(filePath, 'utf-8'))
    onDisk[0].definitionYaml = '[not a mapping]'
    const { writeFileSync } = await import('node:fs')
    writeFileSync(filePath, JSON.stringify(onDisk, null, 2))

    vi.resetModules()
    const mod2 = await import('./workflow-store')
    expect(mod2.getWorkflow(created.id)).toBeNull()
    expect(mod2.listWorkflowsByChannel('anything')).toEqual([])
  })
})
