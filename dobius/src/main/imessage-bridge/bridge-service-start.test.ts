import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as SyncDatabaseModule from '../sqlite/sync-database'

// BUILD-033 review F5: every start advances the d: bridge watermark to the
// newest chat.db row. chat.db is an in-memory stand-in; nothing real is opened.
const mocks = vi.hoisted(() => ({
  config: { enabled: true, triggerPrefix: 'd:', selfHandle: '+15551234' as string | null, lastSeenRowid: 2 },
  failMax: false
}))

vi.mock('../sqlite/sync-database', async () => {
  const actual = await vi.importActual<typeof SyncDatabaseModule>('../sqlite/sync-database')
  class FakeChatDb extends actual.default {
    constructor() {
      super(':memory:')
      this.exec(`
        CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT);
        INSERT INTO message (ROWID, text) VALUES (1, 'a'), (2, 'b'), (3, 'd: sent while off'), (7, 'x');
      `)
      if (mocks.failMax) {
        this.exec('DROP TABLE message')
      }
    }
  }
  return { default: FakeChatDb }
})
vi.mock('./imessage-send', () => ({ sendImessage: vi.fn(), countOutboundLastMinute: () => 0 }))
vi.mock('./bridge-config', () => ({
  getImessageBridgeConfig: () => ({ ...mocks.config }),
  updateImessageBridgeConfig: (updates: Partial<typeof mocks.config>) => {
    mocks.config = { ...mocks.config, ...updates }
    return { ...mocks.config }
  }
}))
vi.mock('../agents/agent-channel-service', () => ({ handleChannelMessage: vi.fn() }))

import { getImessageBridgeStatus, startImessageBridge, stopImessageBridge } from './bridge-service'

const realPlatform = process.platform

afterEach(() => {
  stopImessageBridge()
  Object.defineProperty(process, 'platform', { value: realPlatform })
})

describe('F5 bridge start skips rows sent while it was off', () => {
  it('moves an existing watermark to MAX(ROWID) on every start', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    mocks.config = { ...mocks.config, lastSeenRowid: 2 }
    startImessageBridge()
    expect(mocks.config.lastSeenRowid).toBe(7)
    expect(getImessageBridgeStatus().isRunning).toBe(true)
  })

  it('does not poll when the newest row cannot be read', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    mocks.failMax = true
    mocks.config = { ...mocks.config, lastSeenRowid: 2 }
    startImessageBridge()
    mocks.failMax = false
    expect(mocks.config.lastSeenRowid).toBe(2)
    expect(getImessageBridgeStatus().isRunning).toBe(false)
  })
})
