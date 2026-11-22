import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()

vi.mock('../runtime-client', () => {
  class RuntimeClient {
    readonly isRemote: boolean
    call = callMock
    getCliStatus = vi.fn()
    openDobius = vi.fn()

    constructor(
      _userDataPath?: string,
      _requestTimeoutMs?: number,
      remotePairingCode?: string | null,
      environmentSelector?: string | null
    ) {
      this.isRemote = Boolean(remotePairingCode || environmentSelector)
    }
  }

  class RuntimeClientError extends Error {
    readonly code: string

    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }

  class RuntimeRpcFailureError extends RuntimeClientError {
    readonly response: unknown

    constructor(response: unknown) {
      super('runtime_error', 'runtime_error')
      this.response = response
    }
  }

  return {
    RuntimeClient,
    RuntimeClientError,
    RuntimeRpcFailureError
  }
})

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { main } from '../index'
import { okFixture, queueFixtures } from '../test-fixtures'

const logged = (): string => String(vi.mocked(console.log).mock.calls.at(-1)?.[0])
const errored = (): string => vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join('\n')

describe('dobius file read / write / search', () => {
  let localDir: string

  beforeEach(() => {
    vi.restoreAllMocks()
    callMock.mockReset()
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    localDir = mkdtempSync(join(tmpdir(), 'dobius-file-cli-'))
  })

  afterEach(() => {
    rmSync(localDir, { recursive: true, force: true })
    process.exitCode = undefined
  })

  it('file read prints the content and uses the guarded files.agentRead', async () => {
    queueFixtures(
      callMock,
      okFixture('r', { worktree: 'wt', relativePath: 'src/a.ts', content: 'hello', truncated: false, byteLength: 5 })
    )
    await main(['file', 'read', 'src/a.ts', '--worktree', 'id:wt'], '/tmp/x')
    expect(callMock).toHaveBeenCalledWith('files.agentRead', { worktree: 'id:wt', relativePath: 'src/a.ts' })
    expect(logged()).toBe('hello')
  })

  it('file read --json prints the RPC envelope', async () => {
    queueFixtures(
      callMock,
      okFixture('r', { worktree: 'wt', relativePath: 'a', content: 'x', truncated: true, byteLength: 1 })
    )
    await main(['file', 'read', 'a', '--worktree', 'id:wt', '--json'], '/tmp/x')
    expect(JSON.parse(logged())).toMatchObject({ ok: true, result: { content: 'x', truncated: true } })
  })

  it('file write --content (empty allowed) and --from-file send the text', async () => {
    queueFixtures(callMock, okFixture('w', { relativePath: 'n.md', bytes: 0 }))
    await main(['file', 'write', 'n.md', '--content', '', '--worktree', 'id:wt'], '/tmp/x')
    expect(callMock).toHaveBeenLastCalledWith('files.agentWrite', {
      worktree: 'id:wt',
      relativePath: 'n.md',
      content: ''
    })
    writeFileSync(join(localDir, 'draft.md'), '# Draft')
    queueFixtures(callMock, okFixture('w', { relativePath: 'n.md', bytes: 7 }))
    await main(['file', 'write', 'n.md', '--from-file', 'draft.md', '--worktree', 'id:wt'], localDir)
    expect(callMock).toHaveBeenLastCalledWith('files.agentWrite', {
      worktree: 'id:wt',
      relativePath: 'n.md',
      content: '# Draft'
    })
    expect(logged()).toBe('Wrote 7 bytes to n.md.')
  })

  it('file write --stdin before the positional path still reads stdin', async () => {
    const stdin = Readable.from([Buffer.from('from pipe')])
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as never)
    queueFixtures(callMock, okFixture('w', { relativePath: 'p.txt', bytes: 9 }))
    await main(['file', 'write', '--stdin', 'p.txt', '--worktree', 'id:wt'], '/tmp/x')
    expect(callMock).toHaveBeenLastCalledWith('files.agentWrite', {
      worktree: 'id:wt',
      relativePath: 'p.txt',
      content: 'from pipe'
    })
  })

  it('file write --from-file refuses a file over 5 MB before reading it', async () => {
    writeFileSync(join(localDir, 'big.txt'), Buffer.alloc(5 * 1024 * 1024 + 1))
    await main(['file', 'write', 'n.md', '--from-file', 'big.txt', '--worktree', 'id:wt'], localDir)
    expect(process.exitCode).toBe(1)
    expect(errored()).toMatch(/too large/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('file search has no --regex (it would run caller regexes in the app)', async () => {
    await main(['file', 'search', '--query', 'x', '--regex', '--worktree', 'id:wt'], '/tmp/x')
    expect(process.exitCode).toBe(1)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('file write refuses zero or two content sources before calling', async () => {
    await main(['file', 'write', 'a.txt', '--worktree', 'id:wt'], '/tmp/x')
    expect(process.exitCode).toBe(1)
    expect(errored()).toMatch(/exactly one of --content/)
    process.exitCode = undefined
    await main(['file', 'write', 'a.txt', '--content', 'x', '--stdin', '--worktree', 'id:wt'], '/tmp/x')
    expect(process.exitCode).toBe(1)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('file write surfaces a refusal from main as an error', async () => {
    callMock.mockRejectedValueOnce(new Error('file access refused: secret-looking file'))
    await main(['file', 'write', '.env', '--content', 'x', '--worktree', 'id:wt'], '/tmp/x')
    expect(process.exitCode).toBe(1)
    expect(errored()).toMatch(/file access refused/)
  })

  it('file search maps the flags and prints path:line hits', async () => {
    queueFixtures(
      callMock,
      okFixture('s', {
        files: [
          {
            filePath: '/w/src/a.ts',
            relativePath: 'src/a.ts',
            matches: [{ line: 3, column: 1, matchLength: 4, lineContent: '  TODO fix  ' }]
          }
        ],
        totalMatches: 1,
        truncated: false
      })
    )
    await main(
      ['file', 'search', '--query', 'TODO', '--case-sensitive', '--include', 'src/**', '--limit', '50', '--worktree', 'id:wt'],
      '/tmp/x'
    )
    expect(callMock).toHaveBeenCalledWith('files.agentSearch', {
      worktree: 'id:wt',
      query: 'TODO',
      caseSensitive: true,
      wholeWord: false,
      includePattern: 'src/**',
      excludePattern: undefined,
      maxResults: 50
    })
    expect(logged()).toBe('src/a.ts:3: TODO fix')
  })

  it('file search refuses --limit over 2000 and a missing --query', async () => {
    await main(['file', 'search', '--query', 'x', '--limit', '5000', '--worktree', 'id:wt'], '/tmp/x')
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
    await main(['file', 'search', '--worktree', 'id:wt'], '/tmp/x')
    expect(process.exitCode).toBe(1)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('a remote CLI must name the worktree', async () => {
    await main(['file', 'read', 'a.ts', '--pairing-code', 'abc'], '/tmp/x')
    expect(process.exitCode).toBe(1)
    expect(errored()).toMatch(/require --worktree/)
    expect(callMock).not.toHaveBeenCalled()
  })
})
