import { spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  parseMacOSCodeSignatureOutput,
  readMacOSHelperCodeSignature
} from './macos-code-signature'

vi.mock('child_process', () => ({
  spawn: vi.fn()
}))

const ADHOC_CODESIGN_OUTPUT = [
  'Executable=/Applications/Dobius+ Computer Use.app/Contents/MacOS/dobius-computer-use-macos',
  'Identifier=com.dobius.computer-use',
  'Format=app bundle with Mach-O thin (arm64)',
  'CodeDirectory v=20500 size=1234 flags=0x2(adhoc) hashes=37+5 location=embedded',
  'Signature=adhoc',
  'Info.plist entries=12',
  'TeamIdentifier=not set',
  ''
].join('\n')

const DEVELOPER_ID_CODESIGN_OUTPUT = [
  'Executable=/Applications/Dobius+.app/Contents/MacOS/dobius',
  'Identifier=com.dobius.app',
  'Format=app bundle with Mach-O thin (arm64)',
  'CodeDirectory v=20500 size=4321 flags=0x10002(runtime) hashes=80+3 location=embedded',
  'Signature=Developer ID Application: Example Corp (ABCDE12345)',
  'Info.plist entries=18',
  'TeamIdentifier=ABCDE12345',
  ''
].join('\n')

describe('parseMacOSCodeSignatureOutput', () => {
  it('detects an ad-hoc signature with no team id', () => {
    expect(parseMacOSCodeSignatureOutput(ADHOC_CODESIGN_OUTPUT)).toEqual({
      adhoc: true,
      teamId: null
    })
  })

  it('parses a Developer ID signature and team id', () => {
    expect(parseMacOSCodeSignatureOutput(DEVELOPER_ID_CODESIGN_OUTPUT)).toEqual({
      adhoc: false,
      teamId: 'ABCDE12345'
    })
  })

  it('returns unknown when the output has no signature lines', () => {
    expect(parseMacOSCodeSignatureOutput('garbage noise\nnot a codesign dump\n')).toEqual({
      adhoc: false,
      teamId: null,
      unknown: true
    })
  })

  it('treats a missing or empty TeamIdentifier value as no team id', () => {
    expect(
      parseMacOSCodeSignatureOutput('Signature=Developer ID Application: Dev (GGGGHJKL99)\n')
    ).toEqual({
      adhoc: false,
      teamId: null
    })
    expect(parseMacOSCodeSignatureOutput('Signature=adhoc\nTeamIdentifier=\n')).toEqual({
      adhoc: true,
      teamId: null
    })
  })
})

describe('readMacOSHelperCodeSignature', () => {
  const helperAppPath = '/Applications/Dobius+ Computer Use.app'

  beforeEach(() => {
    vi.mocked(spawn).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawns codesign with an argument array, never a shell string', async () => {
    mockCodesignChild(DEVELOPER_ID_CODESIGN_OUTPUT, 0)

    await expect(readMacOSHelperCodeSignature(helperAppPath)).resolves.toEqual({
      adhoc: false,
      teamId: 'ABCDE12345'
    })
    expect(spawn).toHaveBeenCalledWith('/usr/bin/codesign', ['-dv', '--verbose=2', helperAppPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
  })

  it('reads the signature description from stderr', async () => {
    mockCodesignChild('', 0, ADHOC_CODESIGN_OUTPUT)

    await expect(readMacOSHelperCodeSignature(helperAppPath)).resolves.toEqual({
      adhoc: true,
      teamId: null
    })
  })

  it('returns an unknown signature when codesign fails to launch', async () => {
    mockCodesignError(new Error('spawn codesign ENOENT'))

    await expect(readMacOSHelperCodeSignature(helperAppPath)).resolves.toEqual({
      adhoc: false,
      teamId: null,
      unknown: true
    })
  })

  it('returns an unknown signature when codesign exits non-zero', async () => {
    mockCodesignChild('code object is not signed at all\n', 1)

    await expect(readMacOSHelperCodeSignature(helperAppPath)).resolves.toEqual({
      adhoc: false,
      teamId: null,
      unknown: true
    })
  })

  it('returns an unknown signature when codesign times out', async () => {
    vi.useFakeTimers()
    mockCodesignChild(null, null)

    const statusPromise = readMacOSHelperCodeSignature(helperAppPath)
    const status = await vi.advanceTimersByTimeAsync(5_000).then(() => statusPromise)

    expect(status).toEqual({ adhoc: false, teamId: null, unknown: true })
  })
})

type MockChild = {
  stdout: {
    setEncoding: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    off: ReturnType<typeof vi.fn>
  }
  stderr: {
    setEncoding: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    off: ReturnType<typeof vi.fn>
  }
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
}

function createMockChild(): MockChild {
  return {
    stdout: { setEncoding: vi.fn(), on: vi.fn(), off: vi.fn() },
    stderr: { setEncoding: vi.fn(), on: vi.fn(), off: vi.fn() },
    on: vi.fn(),
    off: vi.fn(),
    kill: vi.fn()
  }
}

function mockCodesignChild(stdout: string | null, code: number | null, stderr = ''): void {
  const child = createMockChild()
  child.on.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
    if (event === 'close') {
      queueMicrotask(() => callback(code))
    }
    return child
  })
  if (stdout !== null) {
    child.stdout.on.mockImplementation((_event: string, callback: (chunk: string) => void) => {
      queueMicrotask(() => callback(stdout))
      return child
    })
  }
  if (stderr !== '') {
    child.stderr.on.mockImplementation((_event: string, callback: (chunk: string) => void) => {
      queueMicrotask(() => callback(stderr))
      return child
    })
  }
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
}

function mockCodesignError(error: Error): void {
  const child = createMockChild()
  child.on.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
    if (event === 'error') {
      queueMicrotask(() => callback(error))
    }
    return child
  })
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
}
