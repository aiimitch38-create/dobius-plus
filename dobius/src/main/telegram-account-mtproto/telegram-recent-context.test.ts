import { describe, expect, it, vi } from 'vitest'
import { readRecentContext } from './telegram-recent-context'

describe('recent Telegram context for Adam drafts', () => {
  it('returns the earlier text messages oldest first with sender labels', async () => {
    const getMessages = vi.fn(async () => [
      { message: 'Can we move it to Friday?', sender: { firstName: 'Anthony', lastName: 'R' } },
      { out: true, message: 'Sure, sending the invoice now' },
      { message: '', sender: { firstName: 'Photo' } },
      { message: 'Thanks for the update', sender: { username: 'nld_ops' } }
    ])
    const context = await readRecentContext({ getMessages }, { id: 'chat' }, 42)
    expect(getMessages).toHaveBeenCalledWith({ id: 'chat' }, { limit: 20, maxId: 42 })
    expect(context).toBe(
      [
        'nld_ops: Thanks for the update',
        'Carson: Sure, sending the invoice now',
        'Anthony R: Can we move it to Friday?'
      ].join('\n')
    )
  })

  it('never blocks a draft when history cannot be read', async () => {
    const getMessages = vi.fn(async () => {
      throw new Error('FLOOD_WAIT')
    })
    await expect(readRecentContext({ getMessages }, {}, 1)).resolves.toBe('')
    await expect(readRecentContext(undefined, {}, 1)).resolves.toBe('')
  })
})
