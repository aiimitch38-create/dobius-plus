import { describe, expect, it, vi } from 'vitest'

const { attachGuestPoliciesMock, isAllowedPartitionMock } = vi.hoisted(() => ({
  attachGuestPoliciesMock: vi.fn(),
  isAllowedPartitionMock: vi.fn((_partition: string) => false)
}))

vi.mock('../browser/browser-manager', () => ({
  browserManager: { attachGuestPolicies: attachGuestPoliciesMock }
}))

vi.mock('../browser/browser-session-registry', () => ({
  browserSessionRegistry: { isAllowedPartition: isAllowedPartitionMock }
}))

import { DOBIUS_WEB_TILE_PARTITION } from '../../shared/constants'

vi.mock('../../shared/browser-url', () => ({
  normalizeBrowserNavigationUrl: vi.fn((src: string) => src)
}))

import { attachWebviewHardening } from './webview-hardening'

describe('Communications webview hardening', () => {
  it('denies a renderer-created webview on a non-browser partition (fail closed)', () => {
    // The native Communications client runs in the main window with the
    // bridge exposed there, so NO renderer-created webview may claim the
    // communications partition anymore — the old guest allowance is gone.
    const handlers = new Map<string, (...args: never[]) => void>()
    const host = {
      on: vi.fn((event: string, handler: (...args: never[]) => void) => handlers.set(event, handler))
    }
    attachWebviewHardening(host as never)

    const event = { preventDefault: vi.fn() }
    const preferences = { partition: 'persist:dobius-communications' }
    handlers.get('will-attach-webview')?.(
      event as never,
      preferences as never,
      { src: 'file:///app/out/renderer/buzz/index.html?embed=dobius' } as never
    )

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect((preferences as { preload?: string }).preload).toBeUndefined()
  })

  it('admits the Board web tile partition exactly and still rejects a look-alike', () => {
    // The allowlist is exact names: 'dobius-web-tile' is in-memory and allowed;
    // 'persist:evil' never is, whatever the registry mock was primed with before.
    isAllowedPartitionMock.mockImplementation(
      (partition: string) => partition === DOBIUS_WEB_TILE_PARTITION
    )
    const handlers = new Map<string, (...args: never[]) => void>()
    const host = {
      on: vi.fn((event: string, handler: (...args: never[]) => void) => handlers.set(event, handler))
    }
    attachWebviewHardening(host as never)

    const allowed = { preventDefault: vi.fn() }
    const tilePrefs = { partition: DOBIUS_WEB_TILE_PARTITION, preload: '/evil.js' }
    handlers.get('will-attach-webview')?.(
      allowed as never,
      tilePrefs as never,
      { src: 'https://example.com/' } as never
    )
    expect(allowed.preventDefault).not.toHaveBeenCalled()
    expect(tilePrefs.partition).toBe('dobius-web-tile')
    expect((tilePrefs as { preload?: string }).preload).toBeUndefined()

    const denied = { preventDefault: vi.fn() }
    handlers.get('will-attach-webview')?.(
      denied as never,
      { partition: 'persist:evil' } as never,
      { src: 'https://example.com/' } as never
    )
    expect(denied.preventDefault).toHaveBeenCalledOnce()
    isAllowedPartitionMock.mockReset()
    isAllowedPartitionMock.mockReturnValue(false)
  })

  it('strips any renderer-provided preload from an allowed guest webview', () => {
    isAllowedPartitionMock.mockReturnValueOnce(true)
    const handlers = new Map<string, (...args: never[]) => void>()
    const host = {
      on: vi.fn((event: string, handler: (...args: never[]) => void) => handlers.set(event, handler))
    }
    attachWebviewHardening(host as never)

    const event = { preventDefault: vi.fn() }
    const preferences = { partition: 'persist:dobius-browser-session-abc', preload: '/evil.js' }
    handlers.get('will-attach-webview')?.(
      event as never,
      preferences as never,
      { src: 'https://example.com/page' } as never
    )

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect((preferences as { preload?: string }).preload).toBeUndefined()
    expect(preferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    })
  })
})
