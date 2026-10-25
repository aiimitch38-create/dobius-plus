import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const callMock = vi.fn()

// Why: isolate the handler's flag-to-RPC mapping; printResult only writes output.
vi.mock('../format', () => ({ printResult: vi.fn() }))

import { REPEATED_FLAG_SEPARATOR } from '../args'
import { TASK_HANDLERS } from './tasks'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'dobius-tasks-cli-'))
  writeFileSync(join(cwd, 'shot.png'), PNG)
  callMock.mockReset()
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
  process.exitCode = undefined
})

function ctx(flags: Record<string, string>, isRemote = false): never {
  return {
    flags: new Map(Object.entries(flags)),
    client: { call: callMock, isRemote },
    cwd,
    json: true
  } as never
}

const okTask = { id: 't1', status: 'done', lease: undefined }
const attached = { result: { attachment: { id: 'a1', mime: 'image/png', bytes: 11, kind: 'proof' }, task: okTask } }

describe('dobius tasks complete --proof', () => {
  it('attaches each proof (absolute path, kind proof, addedBy = --by) and then completes', async () => {
    callMock.mockResolvedValueOnce(attached).mockResolvedValueOnce(attached)
    callMock.mockResolvedValueOnce({ result: { ok: true, task: okTask } })
    await TASK_HANDLERS['tasks complete'](
      ctx({
        id: 't1',
        by: 'console-w1',
        result: 'Login fixed',
        proof: ['shot.png', './shot.png'].join(REPEATED_FLAG_SEPARATOR)
      })
    )
    expect(callMock.mock.calls.map((call) => call[0])).toEqual([
      'tasks.attach',
      'tasks.attach',
      'tasks.complete'
    ])
    expect(callMock.mock.calls[0][1]).toEqual({
      id: 't1',
      file: join(cwd, 'shot.png'),
      dataBase64: undefined,
      name: 'shot.png',
      kind: 'proof',
      addedBy: 'console-w1'
    })
    expect(callMock.mock.calls[2][1]).toMatchObject({ id: 't1', by: 'console-w1', resultNote: 'Login fixed' })
    expect(process.exitCode).toBeUndefined()
  })

  it('does not complete when a proof fails to attach, and says why', async () => {
    callMock.mockRejectedValueOnce(new Error('Not a PNG, JPEG, WebP or GIF image'))
    await expect(
      TASK_HANDLERS['tasks complete'](
        ctx({ id: 't1', by: 'console-w1', result: 'done', proof: 'notes.png' })
      )
    ).rejects.toThrow(/Proof notes.png was not attached, so the card was not moved: Not a PNG/)
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(callMock.mock.calls[0][0]).toBe('tasks.attach')
  })

  it('refuses more than 3 proofs before touching the board', async () => {
    await expect(
      TASK_HANDLERS['tasks complete'](
        ctx({
          id: 't1',
          by: 'w',
          result: 'done',
          proof: ['a.png', 'b.png', 'c.png', 'd.png'].join(REPEATED_FLAG_SEPARATOR)
        })
      )
    ).rejects.toThrow(/at most 3/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('on a remote runtime reads the file here and sends base64 instead of a path', async () => {
    callMock.mockResolvedValueOnce(attached).mockResolvedValueOnce({ result: { ok: true, task: okTask } })
    await TASK_HANDLERS['tasks complete'](
      ctx({ id: 't1', by: 'w', result: 'done', proof: 'shot.png' }, true)
    )
    expect(callMock.mock.calls[0][1]).toMatchObject({
      file: undefined,
      dataBase64: PNG.toString('base64'),
      name: 'shot.png'
    })
  })
})

describe('dobius tasks attach / review / block', () => {
  it('attach defaults kind to proof and --by to DOBIUS_AGENT_ID', async () => {
    vi.stubEnv('DOBIUS_AGENT_ID', 'worker-2')
    callMock.mockResolvedValueOnce(attached)
    await TASK_HANDLERS['tasks attach'](ctx({ id: 't1', file: 'shot.png', name: 'after' }))
    expect(callMock).toHaveBeenCalledWith('tasks.attach', {
      id: 't1',
      file: join(cwd, 'shot.png'),
      dataBase64: undefined,
      name: 'after',
      kind: 'proof',
      addedBy: 'worker-2'
    })
    vi.unstubAllEnvs()
  })

  it('review attaches proof then moves the card; a refusal exits 3', async () => {
    callMock.mockResolvedValueOnce(attached)
    callMock.mockResolvedValueOnce({ result: { ok: false, reason: 'held-by:lead-x' } })
    await TASK_HANDLERS['tasks review'](
      ctx({ id: 't1', by: 'w', note: 'ready', proof: 'shot.png' })
    )
    expect(callMock.mock.calls[1]).toEqual(['tasks.review', { id: 't1', by: 'w', note: 'ready' }])
    expect(process.exitCode).toBe(3)
  })

  it('block without --proof calls the board directly', async () => {
    callMock.mockResolvedValueOnce({ result: { ok: true, task: { ...okTask, status: 'blocked' } } })
    await TASK_HANDLERS['tasks block'](ctx({ id: 't1', by: 'w', reason: 'needs Carson' }))
    expect(callMock).toHaveBeenCalledTimes(1)
    expect(callMock).toHaveBeenCalledWith('tasks.block', { id: 't1', by: 'w', reason: 'needs Carson' })
  })
})
