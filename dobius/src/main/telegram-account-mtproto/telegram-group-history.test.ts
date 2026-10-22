import { Api } from 'teleproto/tl'
import { describe, expect, it, vi } from 'vitest'
import { readIncomingText } from './telegram-events'
import { readGroupHistory } from './telegram-group-history'
import { readSelectedGroupHistory } from '../telegram-account/selected-group-history'

describe('full group history for terminal Adam', () => {
  it('pages back from a message id with ids, dates and full text', async () => {
    const getMessages = vi.fn(async () => [
      { id: 12, date: 1_792_600_000, message: 'Latest note', sender: { firstName: 'Anthony' } },
      { id: 11, date: 1_792_599_000, out: true, message: 'Earlier reply' }
    ])
    const page = await readGroupHistory({ getMessages }, { id: 'chat' }, 13, 500)
    expect(getMessages).toHaveBeenCalledWith({ id: 'chat' }, { limit: 200, maxId: 13 })
    expect(page.count).toBe(2)
    expect(page.oldestMessageId).toBe(11)
    expect(page.text.split('\n')).toEqual([
      expect.stringMatching(/^#11 \S+ Carson: Earlier reply$/),
      expect.stringMatching(/^#12 \S+ Anthony: Latest note$/)
    ])
  })

  it('only reads groups the owner selected, matched by title or id', async () => {
    const groups = [{ id: '-1001', title: 'NLD', kind: 'supergroup' as const }]
    const readHistory = vi.fn(async () => ({ text: 'x', count: 1, oldestMessageId: 1 }))
    const client = { readHistory } as never
    const signal = new AbortController().signal
    const page = await readSelectedGroupHistory(groups, client, {
      group: ' nld ',
      beforeId: 0,
      limit: 50,
      signal
    })
    expect(page.groupTitle).toBe('NLD')
    expect(readHistory).toHaveBeenCalledWith('-1001', 0, 50, signal)
    await expect(
      readSelectedGroupHistory(groups, client, { group: 'Other', beforeId: 0, limit: 5, signal })
    ).rejects.toThrow('group-selection-required')
  })
})

describe('incoming text with a link preview', () => {
  it('treats a web page preview as text, not media', async () => {
    const chat = new Api.Chat({
      id: 42 as never,
      title: 'NLD',
      photo: undefined as never,
      participantsCount: 2,
      date: 0,
      version: 0
    })
    const result = await readIncomingText(
      {
        id: 7,
        message: 'see https://example.com',
        media: new Api.MessageMediaWebPage({ webpage: new Api.WebPageEmpty({ id: 1 as never }) }),
        senderId: '9',
        getChat: async () => chat
      },
      async (entity) => (entity === chat ? '-42' : '9')
    )
    expect(result).toMatchObject({ groupId: '-42', senderId: '9', text: 'see https://example.com' })
  })
})
