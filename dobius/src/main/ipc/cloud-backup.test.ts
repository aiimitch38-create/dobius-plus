import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input?: unknown) => unknown>(),
  connect: vi.fn(),
  status: vi.fn(() => ({ health: 'not_configured' })),
  start: vi.fn()
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/source', getPath: () => '/data' },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  ipcMain: {
    handle: (name: string, handler: (event: unknown, input?: unknown) => unknown) =>
      mocks.handlers.set(name, handler)
  }
}))
vi.mock('../cloud-backup/controller', () => ({
  CloudBackupController: class {
    getStatus = mocks.status
    connect = mocks.connect
    start = mocks.start
  }
}))
import { registerCloudBackupHandlers, setTrustedCloudBackupRenderer } from './cloud-backup'
import type { Store } from '../persistence'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  registerCloudBackupHandlers({} as Store)
  setTrustedCloudBackupRenderer(42)
})
function event(id = 42, subframe = false) {
  const frame = {}
  return { sender: { id, mainFrame: frame }, senderFrame: subframe ? {} : frame }
}
describe('desktop-only AWS credential IPC', () => {
  it('allows connection only from the trusted desktop main frame', () => {
    const handler = mocks.handlers.get('cloudBackup:connect')!
    expect(() => handler(event(99), { secretAccessKey: 'never-handled' })).toThrow(
      'desktop settings'
    )
    expect(() => handler(event(42, true), { secretAccessKey: 'never-handled' })).toThrow(
      'desktop settings'
    )
    expect(mocks.connect).not.toHaveBeenCalled()
    handler(event(), { bucket: 'valid-input' })
    expect(mocks.connect).toHaveBeenCalledWith({ bucket: 'valid-input' })
  })
  it('rejects untrusted status and recovery-key access', async () => {
    for (const channel of [
      'cloudBackup:getStatus',
      'cloudBackup:setEnabled',
      'cloudBackup:runNow'
    ]) {
      expect(() => mocks.handlers.get(channel)!(event(9))).toThrow('desktop settings')
    }
    await expect(mocks.handlers.get('cloudBackup:exportRecoveryKey')!(event(9))).rejects.toThrow(
      'desktop settings'
    )
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('validates schedule changes before dispatch and maps pause/resume explicitly', () => {
    const handler = mocks.handlers.get('cloudBackup:setEnabled')!
    expect(() => handler(event(), 'yes')).toThrow('boolean')
    handler(event(), false)
    handler(event(), true)
    expect(mocks.start.mock.calls).toEqual([['pause'], ['resume']])
  })
})
