import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'

// Why: channel-template-store persists to the userData directory via
// node:fs + electron, so it's mocked here the same way teams.test.ts mocks
// team-store.
vi.mock('../../../communications/canvas/channel-template-store', () => ({
  listChannelTemplates: vi.fn(),
  getChannelTemplate: vi.fn(),
  createChannelTemplate: vi.fn(),
  updateChannelTemplate: vi.fn(),
  removeChannelTemplate: vi.fn(),
  duplicateChannelTemplate: vi.fn()
}))

import {
  createChannelTemplate,
  duplicateChannelTemplate,
  getChannelTemplate,
  listChannelTemplates,
  removeChannelTemplate,
  updateChannelTemplate
} from '../../../communications/canvas/channel-template-store'
import { CHANNEL_TEMPLATE_METHODS } from './channel-templates'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function makeDispatcher(): RpcDispatcher {
  return new RpcDispatcher({ runtime, methods: CHANNEL_TEMPLATE_METHODS })
}

describe('channel template RPC methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists, shows, and deletes channel templates through the store', async () => {
    const template = { id: 'tpl-1', name: 'Standup' }
    vi.mocked(listChannelTemplates).mockReturnValue([template] as never)
    vi.mocked(getChannelTemplate).mockReturnValue(template as never)
    const dispatcher = makeDispatcher()

    await expect(dispatcher.dispatch(makeRequest('channelTemplate.list'))).resolves.toMatchObject({
      ok: true,
      result: { templates: [template] }
    })
    await expect(
      dispatcher.dispatch(makeRequest('channelTemplate.show', { id: 'tpl-1' }))
    ).resolves.toMatchObject({ ok: true, result: { template } })
    await expect(
      dispatcher.dispatch(makeRequest('channelTemplate.delete', { id: 'tpl-1' }))
    ).resolves.toMatchObject({ ok: true, result: { removed: true, id: 'tpl-1' } })
    expect(removeChannelTemplate).toHaveBeenCalledWith('tpl-1')
  })

  it('rejects show, delete, and duplicate for a missing channel template', async () => {
    vi.mocked(getChannelTemplate).mockReturnValue(null)
    await expect(
      makeDispatcher().dispatch(makeRequest('channelTemplate.show', { id: 'ghost' }))
    ).resolves.toMatchObject({ ok: false })
    await expect(
      makeDispatcher().dispatch(makeRequest('channelTemplate.delete', { id: 'ghost' }))
    ).resolves.toMatchObject({ ok: false })
    await expect(
      makeDispatcher().dispatch(makeRequest('channelTemplate.duplicate', { id: 'ghost' }))
    ).resolves.toMatchObject({ ok: false })
    expect(removeChannelTemplate).not.toHaveBeenCalled()
    expect(duplicateChannelTemplate).not.toHaveBeenCalled()
  })

  it('returns the newly appended template from create and the edited template from update', async () => {
    const older = { id: 'tpl-1', name: 'Old' }
    const created = { id: 'tpl-2', name: 'Standup' }
    vi.mocked(createChannelTemplate).mockReturnValue([older, created] as never)
    vi.mocked(updateChannelTemplate).mockReturnValue([older, created] as never)
    const dispatcher = makeDispatcher()

    await expect(
      dispatcher.dispatch(makeRequest('channelTemplate.create', { name: 'Standup' }))
    ).resolves.toMatchObject({ ok: true, result: { template: created } })
    expect(createChannelTemplate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Standup' }))

    await expect(
      dispatcher.dispatch(makeRequest('channelTemplate.update', { id: 'tpl-1', updates: { visibility: 'private' } }))
    ).resolves.toMatchObject({ ok: true, result: { template: older } })
    expect(updateChannelTemplate).toHaveBeenCalledWith('tpl-1', expect.objectContaining({ visibility: 'private' }))
  })

  it('rejects create without a name', async () => {
    await expect(makeDispatcher().dispatch(makeRequest('channelTemplate.create', {}))).resolves.toMatchObject({
      ok: false
    })
    expect(createChannelTemplate).not.toHaveBeenCalled()
  })

  it('duplicates an existing channel template, returning the newly appended copy', async () => {
    const existing = { id: 'tpl-1', name: 'Standup' }
    const copy = { id: 'tpl-2', name: 'Standup (Copy)' }
    vi.mocked(getChannelTemplate).mockReturnValue(existing as never)
    vi.mocked(duplicateChannelTemplate).mockReturnValue([existing, copy] as never)

    await expect(
      makeDispatcher().dispatch(makeRequest('channelTemplate.duplicate', { id: 'tpl-1' }))
    ).resolves.toMatchObject({ ok: true, result: { template: copy } })
    expect(duplicateChannelTemplate).toHaveBeenCalledWith('tpl-1')
  })

  it('passes agent/team entries through to the store on create and update', async () => {
    const created = { id: 'tpl-1', name: 'Standup' }
    vi.mocked(createChannelTemplate).mockReturnValue([created] as never)
    const agents = { personas: [{ personaId: 'agent-1' }], teams: [] }

    await makeDispatcher().dispatch(makeRequest('channelTemplate.create', { name: 'Standup', agents }))
    expect(createChannelTemplate).toHaveBeenCalledWith(expect.objectContaining({ agents }))
  })
})
