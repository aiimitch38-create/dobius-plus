// Codex on 90c6848c: every send outside a draft's Touch ID goes only to a
// handle Carson approved with Touch ID, or the verified self handle.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.hoisted(() =>
  vi.fn((_file: string, _args: string[], _options: unknown, callback: (e: Error | null, r: { stdout: string; stderr: string }) => void) =>
    callback(null, { stdout: '', stderr: '' })
  )
)
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import {
  approveImessageHandle,
  setApprovedHandleStoreForTest,
  setVerifiedSelfHandleSource
} from './approved-handles'
import { sendImessage, sendImessageAfterDraftTouchId } from './imessage-send'

let saved: string[] = []

beforeEach(() => {
  execFileMock.mockClear()
  saved = []
  setApprovedHandleStoreForTest({ list: () => saved, save: (handles) => (saved = handles) })
  setVerifiedSelfHandleSource(() => null)
})

describe('approved iMessage handles', () => {
  it('refuses an unapproved handle with a re-save hint, and sends nothing', async () => {
    await expect(sendImessage('+15550102000', 'hi')).rejects.toThrow(/not approved.*Save it again in Settings and confirm with Touch ID/)
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('approval asks Touch ID with the handle, then the handle can be texted in any spelling', async () => {
    const touchId = vi.fn(async () => null)
    expect(await approveImessageHandle('(555) 010-2000', touchId)).toBeNull()
    expect(touchId).toHaveBeenCalledWith('allow Dobius+ to text (555) 010-2000')
    await sendImessage('+15550102000', 'hi')
    expect(execFileMock).toHaveBeenCalledTimes(1)
    expect(await approveImessageHandle('555-010-2000', touchId)).toBeNull()
    expect(touchId).toHaveBeenCalledTimes(1)
  })

  it('a refused Touch ID approves nothing', async () => {
    expect(await approveImessageHandle('me@x.com', async () => 'Touch ID was not confirmed.')).toMatch(/not saved/)
    expect(saved).toEqual([])
    await expect(sendImessage('me@x.com', 'hi')).rejects.toThrow(/not approved/)
  })

  it('the 7.16 verified self handle may be texted; a changed one may not', async () => {
    let verified: string | null = 'me@x.com'
    setVerifiedSelfHandleSource(() => verified)
    await sendImessage('ME@x.com', 'hi')
    verified = null
    await expect(sendImessage('me@x.com', 'hi')).rejects.toThrow(/not approved/)
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('the draft path is separate: it relies on the per-send Touch ID instead', async () => {
    await sendImessageAfterDraftTouchId('+15550102000', 'at 3')
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })
})
