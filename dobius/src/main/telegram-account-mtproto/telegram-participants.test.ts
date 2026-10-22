import { Api } from 'teleproto/tl'
import { describe, expect, it, vi } from 'vitest'
import type { TeleprotoClient } from './teleproto-runtime'
import { readTelegramParticipants } from './telegram-participants'

function instance<T extends object>(prototype: T, fields: object): T {
  return Object.assign(Object.create(prototype), fields)
}

function fixture(entity: object, participants: object[] = []) {
  const client = {
    getEntity: vi.fn(async () => entity),
    getParticipants: vi.fn(async () => participants)
  }
  return { client, transport: client as unknown as TeleprotoClient }
}

describe('verified Telegram participant metadata', () => {
  it('returns only human members with server names and bounds the group fetch', async () => {
    const user = (fields: object) => instance(Api.User.prototype, fields)
    const f = fixture(instance(Api.Channel.prototype, { megagroup: true }), [
      user({ id: '12', firstName: 'Taylor', lastName: 'Example' }),
      user({ id: '13', username: 'member' }),
      user({ id: '14', firstName: 'x'.repeat(300) }),
      user({ id: '15', bot: true }),
      user({ id: '16', deleted: true }),
      user({ id: '-17' }),
      { id: '18', firstName: 'Unverified object' }
    ])
    const current = vi.fn()
    const result = await readTelegramParticipants(f.transport, '-100123', current)
    expect(result).toEqual([
      { groupId: '-100123', senderId: '12', displayName: 'Taylor Example' },
      { groupId: '-100123', senderId: '13', displayName: 'member' },
      { groupId: '-100123', senderId: '14', displayName: 'x'.repeat(200) }
    ])
    expect(f.client.getParticipants).toHaveBeenCalledWith(expect.any(Api.Channel), { limit: 200 })
    expect(current).toHaveBeenCalledOnce()
  })

  it('refuses direct messages and broadcast channels before member lookup', async () => {
    for (const entity of [
      instance(Api.User.prototype, { id: '12' }),
      instance(Api.Channel.prototype, { megagroup: false })
    ]) {
      const f = fixture(entity)
      await expect(readTelegramParticipants(f.transport, '-100123', () => {})).rejects.toThrow()
      expect(f.client.getParticipants).not.toHaveBeenCalled()
    }
  })

  it('discards metadata if the account operation became stale during the lookup', async () => {
    const f = fixture(instance(Api.Chat.prototype, {}))
    await expect(
      readTelegramParticipants(f.transport, '-123', () => {
        throw new Error('stale-operation')
      })
    ).rejects.toThrow('stale-operation')
  })
})
