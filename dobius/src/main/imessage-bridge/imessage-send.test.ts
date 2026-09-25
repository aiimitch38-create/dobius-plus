import { beforeEach, describe, expect, it, vi } from 'vitest'

// Never runs osascript: execFile is replaced so no AppleScript reaches Messages.
const execFileMock = vi.hoisted(() =>
  vi.fn(
    (
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, result: { stdout: string; stderr: string }) => void
    ) => {
      callback(null, { stdout: '', stderr: '' })
    }
  )
)

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import { isValidImessageHandle, sendImessage } from './imessage-send'

function lastArgs(): string[] {
  return execFileMock.mock.calls.at(-1)?.[1] ?? []
}

beforeEach(() => {
  execFileMock.mockClear()
})

describe('#16 AppleScript send cannot be altered by the handle or text', () => {
  it('passes handle and text as run-handler arguments, never inside the script', async () => {
    await sendImessage('me@x.com', 'plain')
    const firstScript = lastArgs()[1]
    const hostileText = 'a\\" & (do shell script "id") & "\\\nend tell'
    await sendImessage('+1 (555) 123-4567', hostileText)

    const args = lastArgs()
    expect(execFileMock.mock.calls.at(-1)?.[0]).toBe('/usr/bin/osascript')
    expect(args[0]).toBe('-e')
    expect(args[1]).toBe(firstScript)
    expect(args[1]).not.toContain('555')
    expect(args[1]).not.toContain('do shell script')
    expect(args.slice(2)).toEqual(['+1 (555) 123-4567', hostileText])
  })

  it.each([
    'me\\@x.com',
    'a\\" & (do shell script "id") & "@x.com',
    '+1555"; do shell script "id"',
    '-e',
    'me@x.com\n',
    ''
  ])('refuses handle %j before osascript runs', async (handle) => {
    await expect(sendImessage(handle, 'hi')).rejects.toThrow()
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('accepts ordinary phone and email handles', () => {
    expect(isValidImessageHandle('+15551234567')).toBe(true)
    expect(isValidImessageHandle('+1 (555) 123-4567')).toBe(true)
    expect(isValidImessageHandle('carson.b@icloud.com')).toBe(true)
  })

  it('still strips control characters from the text but keeps newlines', async () => {
    await sendImessage('me@x.com', 'line1\nline2\u0000\u0007end')
    expect(lastArgs()[3]).toBe('line1\nline2end')
  })
})
