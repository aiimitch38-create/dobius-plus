import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DobiusRuntimeService } from './dobius-runtime'
import { shouldEnableRuntimeWebSocket } from './mobile-listener-setting'
import { readRuntimeMetadata } from './runtime-metadata'
import { DobiusRuntimeRpcServer } from './runtime-rpc'
import { WebSocketTransport } from './rpc/ws-transport'

describe('shouldEnableRuntimeWebSocket', () => {
  it('is off when the setting is missing, false, or settings are unavailable', () => {
    expect(shouldEnableRuntimeWebSocket({ settings: {}, isServeMode: false })).toBe(false)
    expect(
      shouldEnableRuntimeWebSocket({
        settings: { mobileListenerEnabled: false },
        isServeMode: false
      })
    ).toBe(false)
    expect(shouldEnableRuntimeWebSocket({ settings: null, isServeMode: false })).toBe(false)
  })

  it('is on only when the user explicitly enabled it', () => {
    expect(
      shouldEnableRuntimeWebSocket({ settings: { mobileListenerEnabled: true }, isServeMode: false })
    ).toBe(true)
  })

  it('stays on for an explicit `dobius serve` launch', () => {
    expect(shouldEnableRuntimeWebSocket({ settings: {}, isServeMode: true })).toBe(true)
  })
})

describe('DobiusRuntimeRpcServer phone listener switch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates no WebSocket listener when the switch is off', async () => {
    const startSpy = vi.spyOn(WebSocketTransport.prototype, 'start')
    const userDataPath = mkdtempSync(join(tmpdir(), 'dobius-listener-off-'))
    const server = new DobiusRuntimeRpcServer({
      runtime: new DobiusRuntimeService(),
      userDataPath,
      enableWebSocket: shouldEnableRuntimeWebSocket({ settings: {}, isServeMode: false }),
      wsPort: 0
    })

    await server.start()
    try {
      expect(startSpy).not.toHaveBeenCalled()
      expect(server['wsTransport']).toBeNull()
      expect(server.getWebSocketEndpoint()).toBeNull()
      expect(server.getDeviceRegistry()).toBeNull()
      expect(server.createPairingOffer({ address: '192.168.1.5' })).toEqual({ available: false })
      const kinds = readRuntimeMetadata(userDataPath)?.transports?.map((t) => t.kind)
      expect(kinds).not.toContain('websocket')
      expect(kinds?.length).toBe(1)
    } finally {
      await server.stop()
    }
  })

  it('still starts the WebSocket listener when the switch is on', async () => {
    const startSpy = vi.spyOn(WebSocketTransport.prototype, 'start')
    const userDataPath = mkdtempSync(join(tmpdir(), 'dobius-listener-on-'))
    const server = new DobiusRuntimeRpcServer({
      runtime: new DobiusRuntimeService(),
      userDataPath,
      enableWebSocket: shouldEnableRuntimeWebSocket({
        settings: { mobileListenerEnabled: true },
        isServeMode: false
      }),
      wsPort: 0
    })

    await server.start()
    try {
      expect(startSpy).toHaveBeenCalledTimes(1)
      expect(server.getWebSocketEndpoint()).toMatch(/^ws:\/\/0\.0\.0\.0:\d+$/)
      expect(server.createPairingOffer({ address: '192.168.1.5' }).available).toBe(true)
    } finally {
      await server.stop()
    }
  })
})
