import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JarvisAskResult, LiveVoiceNotice } from '../../shared/speech-types'
import { LIVE_WORD_FOR_WORD_LEAD, LiveVoiceCalls } from './live-voice-calls'
import { LiveVoiceMeter } from './live-voice-meter'

let dir = ''
let notices: LiveVoiceNotice[] = []
let finish: ((result: JarvisAskResult) => void) | null = null
let wordForWord = false

function makeCalls(): LiveVoiceCalls {
  return new LiveVoiceCalls({
    meter: new LiveVoiceMeter(join(dir, 'meter.json'), () => 0),
    capUsd: () => 15,
    notify: (notice) => notices.push(notice),
    ask: () =>
      new Promise<JarvisAskResult>((resolve) => {
        finish = resolve
      }),
    isAdamBusy: () => false,
    cancelAdam: () => finish?.({ kind: 'cancelled', text: '' }),
    lookingAt: () => null,
    appendThread: async () => undefined,
    setInterval: () => 1,
    clearInterval: () => undefined,
    wordForWord: () => wordForWord,
    log: vi.fn()
  })
}

const progress = (): LiveVoiceNotice[] => notices.filter((notice) => notice.kind === 'adam-progress')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'live-progress-'))
  notices = []
  finish = null
  wordForWord = false
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('live progress notes (7.13)', () => {
  it("forwards ADAM's steps only while the call's own request runs", async () => {
    const calls = makeCalls()
    calls.progress('reading')
    expect(progress()).toEqual([])
    const token = calls.callStarted(7)
    const answer = calls.delegate(7, { request: 'check the build', delegationId: 'd1' })
    await vi.waitFor(() => expect(finish).not.toBeNull())
    calls.progress('dobius-command')
    expect(progress()).toEqual([
      { kind: 'adam-progress', text: '', step: 'dobius-command', callToken: token, delegationId: 'd1' }
    ])
    finish?.({ kind: 'answer', text: 'All green.' })
    await answer
    calls.progress('editing')
    expect(progress()).toHaveLength(1)
  })

  it('sends no step after Carson says stop', async () => {
    const calls = makeCalls()
    calls.callStarted(7)
    const answer = calls.delegate(7, { request: 'check the build', delegationId: 'd1' })
    await vi.waitFor(() => expect(finish).not.toBeNull())
    calls.cancelDelegation(7)
    calls.progress('reading')
    await answer
    expect(progress()).toEqual([])
  })
})

describe('progress names its delegation (7.13 review)', () => {
  it('sends nothing for a request that carries no delegation id to name', async () => {
    const calls = makeCalls()
    calls.callStarted(7)
    const answer = calls.delegate(7, { request: 'check the build' })
    await vi.waitFor(() => expect(finish).not.toBeNull())
    calls.progress('reading')
    finish?.({ kind: 'answer', text: 'ok' })
    await answer
    expect(progress()).toEqual([])
  })

  it('ignores a malformed delegation id', async () => {
    const calls = makeCalls()
    calls.callStarted(7)
    const answer = calls.delegate(7, { request: 'check', delegationId: '<script>' })
    await vi.waitFor(() => expect(finish).not.toBeNull())
    calls.progress('reading')
    finish?.({ kind: 'answer', text: 'ok' })
    await answer
    expect(progress()).toEqual([])
  })
})

describe('read facts word for word (7.13)', () => {
  async function spoken(): Promise<string> {
    const calls = makeCalls()
    calls.callStarted(7)
    const answer = calls.delegate(7, { request: 'what is the port?' })
    await vi.waitFor(() => expect(finish).not.toBeNull())
    finish?.({ kind: 'answer', text: 'The port is 8421.' })
    const result = await answer
    return result.ok ? result.speak : ''
  }

  it('is off by default: the answer goes as is, for the voice to put in its own words', async () => {
    expect(await spoken()).toBe('The port is 8421.')
  })

  it('when on, asks the voice to say the answer exactly', async () => {
    wordForWord = true
    expect(await spoken()).toBe(`${LIVE_WORD_FOR_WORD_LEAD}The port is 8421.`)
  })
})
