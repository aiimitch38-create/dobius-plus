import { describe, expect, it, vi } from 'vitest'
import { incoming, makeConnectedService } from './test-support'

describe('Telegram inference-only lifecycle', () => {
  it('fences a resolved inference continuation when Stop happens before publication', async () => {
    let resolve!: (text: string) => void
    const provider = new Promise<string>((done) => {
      resolve = done
    })
    const reply = vi.fn(() => provider)
    const f = makeConnectedService({ reply })
    await f.service.restore()
    await f.service.startReplies()
    f.client.emit(incoming())
    expect(reply).toHaveBeenCalledOnce()
    const stopped = provider.then(() => f.service.stopReplies())
    resolve('Must not publish after Stop')
    await stopped
    await vi.waitFor(() => expect(f.vault.state.inboundEvents[0].state).toBe('manual-review'))
    expect(f.service.snapshot().drafts).toEqual([])
    expect(f.service.snapshot().connected).toBe(true)
    expect(f.client.disconnect).not.toHaveBeenCalled()
    expect(f.service.getManualReview()).toEqual([
      {
        groupId: '-1001',
        groupTitle: 'Build',
        messageId: '991',
        admittedAt: expect.any(Number)
      }
    ])
  })

  it('keeps account metadata operations usable when inference stops', async () => {
    const f = makeConnectedService()
    await f.service.restore()
    await f.service.startReplies()
    let release!: () => void
    const blocked = new Promise<void>((done) => {
      release = done
    })
    Object.assign(f.client, {
      listParticipants: vi.fn(async (_id: string, signal: AbortSignal) => {
        await blocked
        expect(signal.aborted).toBe(false)
        return [{ groupId: '-1001', senderId: '88', displayName: 'Verified participant' }]
      })
    })
    const pending = f.service.listParticipants('-1001')
    await f.service.stopReplies()
    release()
    await expect(pending).resolves.toHaveLength(1)
    expect(f.service.snapshot().connected).toBe(true)
  })
})
