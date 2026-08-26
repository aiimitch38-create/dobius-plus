import { describe, expect, it, vi } from 'vitest'

const { attachGuestPoliciesMock, isAllowedPartitionMock } = vi.hoisted(() => ({
  attachGuestPoliciesMock: vi.fn(),
  isAllowedPartitionMock: vi.fn(() => false)
}))

vi.mock('../browser/browser-manager', () => ({
  browserManager: { attachGuestPolicies: attachGuestPoliciesMock }
}))

vi.mock('../browser/browser-session-registry', () => ({
  browserSessionRegistry: { isAllowedPartition: isAllowedPartitionMock }
}))

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
