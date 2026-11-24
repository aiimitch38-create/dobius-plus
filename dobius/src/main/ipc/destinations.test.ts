// Codex on 90c6848c: an iMessage destination is saved only after Touch ID.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  save: vi.fn((input: unknown) => input),
  approve: vi.fn(async (_handle: string): Promise<string | null> => null)
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler)
  }
}))
vi.mock('../destinations/destinations-store', () => ({
  deleteDestination: vi.fn(),
  getDestination: vi.fn(),
  listDestinations: vi.fn(() => []),
  saveDestination: mocks.save
}))
vi.mock('../destinations/destination-delivery', () => ({ deliverToDestination: vi.fn() }))
vi.mock('../imessage-bridge/approved-handles', () => ({ approveImessageHandle: mocks.approve }))

import { registerDestinationHandlers } from './destinations'

const save = (input: unknown): unknown => mocks.handlers.get('destinations:save')?.({}, input)

beforeEach(() => {
  mocks.handlers.clear()
  vi.clearAllMocks()
  registerDestinationHandlers()
})

describe('destinations:save', () => {
  it('asks Touch ID for an iMessage handle and saves nothing on a refusal', async () => {
    mocks.approve.mockResolvedValueOnce('me@x.com was not saved: Touch ID was not confirmed.')
    const input = { name: 'Phone', type: 'imessage', config: { handle: 'me@x.com' } }
    await expect(save(input)).rejects.toThrow(/not saved/)
    expect(mocks.save).not.toHaveBeenCalled()
    await save(input)
    expect(mocks.approve).toHaveBeenLastCalledWith('me@x.com')
    expect(mocks.save).toHaveBeenCalledWith(input)
  })

  it('other destination types need no Touch ID', async () => {
    await save({ name: 'Mac', type: 'system', config: {} })
    expect(mocks.approve).not.toHaveBeenCalled()
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })
})
