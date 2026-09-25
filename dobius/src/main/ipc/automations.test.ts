import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))

vi.mock('../automations/external-manager', () => ({
  createExternalAutomation: vi.fn(),
  listExternalAutomationManagers: vi.fn(),
  listExternalAutomationRuns: vi.fn(),
  runExternalAutomationAction: vi.fn(),
  updateExternalAutomation: vi.fn()
}))

describe('automations IPC runNow (CX12 F4)', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('marks the desktop UI run-now as a human trigger that bypasses Pause crew', async () => {
    const { registerAutomationHandlers } = await import('./automations')
    const runNow = vi.fn().mockResolvedValue({ id: 'run-1' })
    registerAutomationHandlers({} as never, { runNow } as never)

    await handlers.get('automations:runNow')?.({}, { id: 'automation-1' })

    expect(runNow).toHaveBeenCalledWith('automation-1', true)
  })
})
