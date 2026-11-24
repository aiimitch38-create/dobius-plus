// Codex on 90c6848c: the older send paths (bridge test text, conductor,
// destinations) all go through the approved-handle check in sendImessage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: { enabled: true, triggerPrefix: 'd:', selfHandle: '+15550102000' as string | null, lastSeenRowid: 0 },
  execFile: vi.fn((_file: string, _args: string[], _options: unknown, callback: (e: Error | null, r: { stdout: string; stderr: string }) => void) =>
    callback(null, { stdout: '', stderr: '' })
  )
}))

vi.mock('node:child_process', () => ({ execFile: mocks.execFile }))
vi.mock('electron', () => ({ Notification: { isSupported: () => false }, systemPreferences: {} }))
vi.mock('../sqlite/sync-database', () => ({ default: vi.fn() }))
vi.mock('./bridge-config', () => ({
  getImessageBridgeConfig: () => ({ ...mocks.config }),
  getImessageBridgeConfigUnreadableDetail: () => null,
  updateImessageBridgeConfig: vi.fn()
}))
vi.mock('../agents/agent-channel-service', () => ({ handleChannelMessage: vi.fn() }))

import { deliverToDestination } from '../destinations/destination-delivery'
import { createIMessageBridge } from '../voice-conductor/imessage-bridge'
import { approveImessageHandle, setApprovedHandleStoreForTest, setVerifiedSelfHandleSource } from './approved-handles'
import { testImessageSend } from './bridge-service'

const realPlatform = process.platform
let saved: string[] = []

beforeEach(() => {
  mocks.execFile.mockClear()
  mocks.config.selfHandle = '+15550102000'
  saved = []
  setApprovedHandleStoreForTest({ list: () => saved, save: (handles) => (saved = handles) })
  setVerifiedSelfHandleSource(() => null)
  Object.defineProperty(process, 'platform', { value: 'darwin' })
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform })
})

const conductor = () => createIMessageBridge({ resolveHandle: () => mocks.config.selfHandle, platform: 'darwin' })
const destination = (handle: string) =>
  ({ id: 'd1', name: 'Phone', type: 'imessage', config: { handle }, createdAt: 0, updatedAt: 0 }) as const

describe('every older send path needs an approved handle', () => {
  it('an approved selfHandle works for testSend and the conductor', async () => {
    expect(await approveImessageHandle('+15550102000', async () => null)).toBeNull()
    expect(await testImessageSend()).toEqual({ ok: true })
    await conductor().send('done')
    expect(mocks.execFile).toHaveBeenCalledTimes(2)
  })

  it('a selfHandle changed without Touch ID cannot be texted by testSend or the conductor', async () => {
    expect(await approveImessageHandle('+15550102000', async () => null)).toBeNull()
    mocks.config.selfHandle = '+15559990000'
    expect(await testImessageSend()).toMatchObject({ ok: false, error: /not approved/ })
    await expect(conductor().send('done')).rejects.toThrow(/not approved/)
    await expect(conductor().ask('ok?', 1000)).rejects.toThrow()
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it('an unapproved destination (saved before this change) is refused; an approved one sends', async () => {
    const message = { title: 'Run done', body: 'ok' }
    await expect(deliverToDestination(destination('me@x.com'), message)).rejects.toThrow(
      /me@x.com is not approved.*Save it again in Settings and confirm with Touch ID/
    )
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(await approveImessageHandle('me@x.com', async () => null)).toBeNull()
    await deliverToDestination(destination('me@x.com'), message)
    expect(mocks.execFile).toHaveBeenCalledTimes(1)
  })
})
