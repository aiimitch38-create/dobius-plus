import { describe, expect, it, vi } from 'vitest'
import type { JarvisAskResult } from '../../../../../shared/speech-types'
import { ADAM_MAX_UTTERANCE_CHARS, buildAdamThreadMessage, talkToAdam } from './adam-thread'
import { BOARD } from './plan-fixtures.test-support'

const context = { projectName: 'dobius-plus', folder: '/Users/c/code/dobius-plus', board: BOARD }

function harness(transport: (message: string) => Promise<JarvisAskResult>) {
  const rows: { role: string; text: string; tone?: string }[] = []
  const done = vi.fn()
  const showThinking = vi.fn((_text: string) => done)
  const busy = { current: false }
  const send = (utterance: string, turns: { role: 'user' | 'assistant'; text: string }[] = []) =>
    talkToAdam({
      transport,
      context,
      turns,
      utterance,
      busy,
      append: (message) => rows.push(message),
      showThinking
    })
  return { rows, done, showThinking, busy, send }
}

describe('buildAdamThreadMessage', () => {
  it('tells ADAM the project, workspace folder, board and earlier turns before the new words', () => {
    const message = buildAdamThreadMessage({
      context,
      turns: [
        { role: 'user', text: 'i cant heear him speak' },
        { role: 'assistant', text: 'Which speaker are you using?' }
      ],
      utterance: 'your TypeScript app'
    })
    expect(message).toContain('Project: dobius-plus')
    expect(message).toContain('Workspace: main (folder: /Users/c/code/dobius-plus)')
    expect(message).toContain('- Claude 1 (claude, idle, group Team A)')
    expect(message).toContain('Carson: i cant heear him speak')
    expect(message).toContain('Thread: Which speaker are you using?')
    expect(message.endsWith('Carson: your TypeScript app')).toBe(true)
  })

  it('keeps only the last six turns, each cut short', () => {
    const turns = Array.from({ length: 9 }, (_, i) => ({
      role: 'user' as const,
      text: `turn ${i} ${'x'.repeat(500)}`
    }))
    const message = buildAdamThreadMessage({ context, turns, utterance: 'hi' })
    expect(message).not.toContain('turn 2 ')
    expect(message).toContain('turn 3 ')
    expect(message.length).toBeLessThan(4_000)
  })
})

describe('talkToAdam', () => {
  it('sends the message to the Hermes transport and appends the reply as ADAM', async () => {
    const transport = vi.fn(
      async (_message: string): Promise<JarvisAskResult> => ({
        kind: 'answer',
        text: ' I am here. '
      })
    )
    const h = harness(transport)
    await h.send('your TypeScript app')
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0][0]).toContain('Carson: your TypeScript app')
    expect(h.rows).toEqual([{ role: 'assistant', text: 'I am here.' }])
  })

  it('shows a thinking row while waiting and takes it away when the reply lands', async () => {
    let answer: (result: JarvisAskResult) => void = () => {}
    const h = harness(() => new Promise((resolve) => (answer = resolve)))
    const pending = h.send('hello')
    expect(h.showThinking).toHaveBeenCalledWith('ADAM is thinking…')
    expect(h.done).not.toHaveBeenCalled()
    expect(h.busy.current).toBe(true)
    answer({ kind: 'answer', text: 'Hi.' })
    await pending
    expect(h.done).toHaveBeenCalledTimes(1)
    expect(h.busy.current).toBe(false)
  })

  it('turns a Hermes failure into a plain error that says what to do', async () => {
    const h = harness(async () => ({
      kind: 'error',
      text: 'Could not connect to Adam’s Hermes profile. Check that Hermes and the adam profile are installed and signed in.'
    }))
    await h.send('hello')
    expect(h.rows).toHaveLength(1)
    expect(h.rows[0]).toMatchObject({ role: 'system', tone: 'error' })
    expect(h.rows[0].text).toContain('ADAM could not answer.')
    expect(h.rows[0].text).toContain('Check that Hermes and the adam profile are installed')
    expect(h.rows[0].text).toContain('@Codex 1 run the tests')
    expect(h.rows[0].text).not.toMatch(/planner/i)
    expect(h.done).toHaveBeenCalledTimes(1)
  })

  it('reports an unreachable connection when the call itself throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = harness(async () => {
      throw new Error("No handler registered for 'jarvis:askAdamText'")
    })
    await h.send('hello')
    expect(h.rows[0]).toMatchObject({ role: 'system', tone: 'error' })
    expect(h.rows[0].text).toContain('Quit and reopen Dobius+')
    expect(h.rows[0].text).not.toContain('No handler registered')
    expect(h.busy.current).toBe(false)
    warn.mockRestore()
  })

  it('treats an empty answer as a failure, and a cancelled turn as a note', async () => {
    const empty = harness(async () => ({ kind: 'answer', text: '  ' }))
    await empty.send('hello')
    expect(empty.rows[0]).toMatchObject({ role: 'system', tone: 'error' })
    const cancelled = harness(async () => ({ kind: 'cancelled', text: '' }))
    await cancelled.send('hello')
    expect(cancelled.rows[0].role).toBe('system')
    expect(cancelled.rows[0].tone).toBeUndefined()
  })

  it('does not start a second turn while ADAM is still answering', async () => {
    let answer: (result: JarvisAskResult) => void = () => {}
    const transport = vi.fn(
      (_message: string) => new Promise<JarvisAskResult>((resolve) => (answer = resolve))
    )
    const h = harness(transport)
    const first = h.send('one')
    await h.send('two')
    expect(transport).toHaveBeenCalledTimes(1)
    expect(h.rows[0].text).toContain('still answering')
    answer({ kind: 'answer', text: 'Done.' })
    await first
    expect(h.rows.at(-1)).toEqual({ role: 'assistant', text: 'Done.' })
  })

  it('refuses a message too long for one Hermes turn without calling ADAM', async () => {
    const transport = vi.fn(async (): Promise<JarvisAskResult> => ({ kind: 'answer', text: 'x' }))
    const h = harness(transport)
    await h.send('x'.repeat(ADAM_MAX_UTTERANCE_CHARS + 1))
    expect(transport).not.toHaveBeenCalled()
    expect(h.rows[0].text).toContain('too long')
  })
})
