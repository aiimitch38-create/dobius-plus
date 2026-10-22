import { describe, expect, it, vi } from 'vitest'
import { TelegramReplyStartup } from './telegram-reply-startup'
import { makeConnectedService, GROUPS } from '../telegram-account/test-support'
import type { AdamReplyGateway } from '../telegram-account/adam-reply-gateway'

async function fixture() {
  const f = makeConnectedService()
  await f.service.restore()
  let release!: () => void
  const starting = new Promise<void>((resolve) => {
    release = resolve
  })
  const gateway = { start: vi.fn(() => starting), stop: vi.fn(async () => undefined) }
  const control = new TelegramReplyStartup(f.service, gateway as unknown as AdamReplyGateway)
  return { ...f, control, gateway, release }
}

describe('Telegram bridge startup authority', () => {
  it('does not subscribe when Stop supersedes a pending gateway startup', async () => {
    const f = await fixture()
    const pending = f.control.start()
    const refused = expect(pending).rejects.toThrow('stale-operation')
    await f.control.stop()
    f.release()
    await refused
    expect(f.client.subscribe).not.toHaveBeenCalled()
    expect(f.service.snapshot().connected).toBe(true)
  })

  it('rechecks selected group identity after the gateway becomes ready', async () => {
    const f = await fixture()
    const pending = f.control.start()
    const refused = expect(pending).rejects.toThrow('stale-operation')
    f.client.dialogs = GROUPS.map((group) =>
      group.id === '-1001' ? { ...group, title: 'Changed group' } : group
    )
    await f.service.selectGroups(GROUPS.slice(0, 3).map((group) => group.id))
    f.release()
    await refused
    expect(f.client.subscribe).not.toHaveBeenCalled()
    expect(f.gateway.stop).toHaveBeenCalledOnce()
  })

  it('starts listening with no per-participant consent records', async () => {
    const f = await fixture()
    f.release()
    await f.control.start()
    expect(f.client.subscribe).toHaveBeenCalledOnce()
  })

  it('does not let an older delayed stop kill a newer start', async () => {
    const f = await fixture()
    f.release()
    await f.control.start()
    let releaseStop!: () => void
    const blocked = new Promise<void>((resolve) => {
      releaseStop = resolve
    })
    const actualStop = f.service.stopReplies.bind(f.service)
    vi.spyOn(f.service, 'stopReplies').mockImplementationOnce(async () => {
      await actualStop()
      await blocked
    })
    const stopping = f.control.stop()
    await f.control.start()
    releaseStop()
    await stopping
    expect(f.service.isListening()).toBe(true)
    expect(f.gateway.stop).not.toHaveBeenCalled()
    await actualStop()
  })
})
