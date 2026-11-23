import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdamThreadRow } from '../../shared/speech-types'
import { AdamNotifier, AdamNotifyRefused, adamNotifyText } from './adam-notify'

const MINUTE = 60_000

let now = 0
let enabled = true
let callOpen = false
const rows: AdamThreadRow[] = []
const sayLive = vi.fn((_text: string, _urgent: boolean) => callOpen)
const showNotification = vi.fn()

function notifier(): AdamNotifier {
  return new AdamNotifier({
    enabled: () => enabled,
    appendThread: async (row) => void rows.push(row),
    sayLive,
    showNotification,
    now: () => now
  })
}

beforeEach(() => {
  now = 1_000_000
  enabled = true
  callOpen = false
  rows.length = 0
  vi.clearAllMocks()
})

describe('adamNotifyText', () => {
  it('keeps one plain line and refuses empty, long and secret text', () => {
    expect(adamNotifyText('  Deploy\nis   waiting  ')).toBe('Deploy is waiting')
    expect(() => adamNotifyText('   ')).toThrow(AdamNotifyRefused)
    expect(() => adamNotifyText('x'.repeat(301))).toThrow(/too long/)
    expect(adamNotifyText(`${'word '.repeat(59)}last!`)).toHaveLength(300)
    expect(() => adamNotifyText('the key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789')).toThrow(
      /secret/
    )
    expect(() => adamNotifyText(42)).toThrow(/Missing/)
  })
})

describe('AdamNotifier delivery', () => {
  it('with no call: a thread row and a notification titled ADAM', async () => {
    const result = await notifier().notify('The PR has waited an hour.', false)
    expect(result).toEqual({ delivered: 'notification', savedInThread: true })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ role: 'assistant', text: 'The PR has waited an hour.', adamNotify: true })
    expect(rows[0].conductor).toBeUndefined()
    expect(showNotification).toHaveBeenCalledWith('ADAM', 'The PR has waited an hour.')
  })

  it('on a live call: a thread row and the quiet-gated voice, no notification', async () => {
    callOpen = true
    const result = await notifier().notify('Build is done.', true)
    expect(result.delivered).toBe('spoken')
    expect(sayLive).toHaveBeenCalledWith('Build is done.', true)
    expect(showNotification).not.toHaveBeenCalled()
    expect(rows[0]).toMatchObject({ urgent: true })
  })

  it('still delivers when the thread row cannot be saved, and says so', async () => {
    const failing = new AdamNotifier({
      enabled: () => true,
      appendThread: async () => {
        throw new Error('disk full')
      },
      sayLive,
      showNotification,
      now: () => now
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(failing.notify('hello', false)).resolves.toEqual({
      delivered: 'notification',
      savedInThread: false
    })
  })

  it('is refused when Carson turned the setting off', async () => {
    enabled = false
    await expect(notifier().notify('hi', false)).rejects.toThrow(/tap me on the shoulder/)
    expect(rows).toHaveLength(0)
  })
})

describe('AdamNotifier rate limits', () => {
  it('allows one every 5 minutes and at most 4 an hour', async () => {
    const tap = notifier()
    await tap.notify('one', false)
    now += 4 * MINUTE
    await expect(tap.notify('too soon', false)).rejects.toThrow(/every 5 minutes/)
    now += MINUTE
    await tap.notify('two', false)
    now += 5 * MINUTE
    await tap.notify('three', false)
    now += 5 * MINUTE
    await tap.notify('four', false)
    now += 5 * MINUTE
    await expect(tap.notify('five', false)).rejects.toThrow(/4 times in the last hour/)
    now += 45 * MINUTE
    await expect(tap.notify('next hour', false)).resolves.toMatchObject({ delivered: 'notification' })
    expect(rows.map((row) => row.text)).toEqual(['one', 'two', 'three', 'four', 'next hour'])
  })

  it('lets urgent skip the 5 minute gap, at most 2 urgent an hour, within the 4', async () => {
    const tap = notifier()
    await tap.notify('normal', false)
    await tap.notify('urgent one', true)
    await tap.notify('urgent two', true)
    await expect(tap.notify('urgent three', true)).rejects.toThrow(/2 urgent/)
    now += 5 * MINUTE
    await tap.notify('normal two', false)
    now += 5 * MINUTE
    await expect(tap.notify('normal three', false)).rejects.toThrow(/4 times/)
  })

  it('does not count refused taps', async () => {
    const tap = notifier()
    await expect(tap.notify('', false)).rejects.toThrow()
    await expect(tap.notify('ok', false)).resolves.toBeDefined()
  })
})
