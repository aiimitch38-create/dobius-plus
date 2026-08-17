import { describe, expect, it, vi } from 'vitest'

const { attachGuestPoliciesMock } = vi.hoisted(() => ({
  attachGuestPoliciesMock: vi.fn()
}))

vi.mock('../browser/browser-manager', () => ({
  browserManager: { attachGuestPolicies: attachGuestPoliciesMock }
}))

vi.mock('../browser/browser-session-registry', () => ({
  browserSessionRegistry: { isAllowedPartition: vi.fn(() => false) }
}))

vi.mock('../communications/communications-guest', () => ({
  isTrustedCommunicationsGuestUrl: vi.fn((source: string) => source.startsWith('file:'))
}))

vi.mock('../../shared/browser-url', () => ({
  normalizeBrowserNavigationUrl: vi.fn(() => null)
}))

import { attachWebviewHardening } from './webview-hardening'

describe('Communications webview hardening', () => {
  it('allows the trusted packaged file URL and injects only its narrow preload', () => {
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

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(preferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:dobius-communications',
      sandbox: true
    })
    expect((preferences as { preload?: string }).preload).toMatch(/communications\.js$/)
  })
})
