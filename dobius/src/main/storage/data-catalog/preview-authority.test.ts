import { describe, expect, it } from 'vitest'
import { CatalogPreviewAuthorityEpoch } from './preview-authority'
import type { CatalogPreviewPrincipal, LocalWebContentsPreviewPrincipal } from './preview-principal'

const device = '8de3037a-7171-4399-af40-9e31de2cb59e'
function principal(signal = new AbortController().signal): LocalWebContentsPreviewPrincipal {
  return {
    kind: 'local-webcontents',
    principalId: 'desktop',
    connectionId: 'ipc:17:navigation:2',
    hostId: 'host-fixture',
    webContentsId: 17,
    navigationId: 'navigation-2',
    signal
  }
}

describe('catalog preview authority epoch', () => {
  it('binds tickets to one trusted connection incarnation and current epoch', () => {
    const authority = new CatalogPreviewAuthorityEpoch()
    const actor = principal()
    const ticket = authority.capture(actor)!
    expect(authority.isCurrent(ticket, actor)).toBe(true)
    expect(authority.isCurrent(ticket, { ...actor, navigationId: 'navigation-3' })).toBe(false)
    expect(authority.isCurrent(ticket, { ...actor, hostId: 'other-host' })).toBe(false)
    authority.advance()
    expect(authority.isCurrent(ticket, actor)).toBe(false)
  })

  it('refuses an aborted WebContents navigation and verified non-mobile scope', () => {
    const authority = new CatalogPreviewAuthorityEpoch()
    const controller = new AbortController()
    const actor = principal(controller.signal)
    const ticket = authority.capture(actor)!
    controller.abort()
    expect(authority.capture(actor)).toBeNull()
    expect(authority.isCurrent(ticket, actor)).toBe(false)
    expect(
      authority.capture({
        kind: 'paired-mobile',
        principalId: `device:${device}`,
        deviceId: device,
        connectionId: 'ws-fixture',
        hostId: 'host-fixture',
        scope: 'runtime',
        signal: new AbortController().signal
      } as unknown as CatalogPreviewPrincipal)
    ).toBeNull()
  })
})
