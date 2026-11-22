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

describe('dobius tasks update', () => {
  it('maps flags to tasks.update, with repeated --label replacing labels', async () => {
    callMock.mockResolvedValueOnce({ result: { ok: true, task: okTask } })
    await TASK_HANDLERS['tasks update'](
      ctx({
        id: 't1',
        by: 'adam',
        title: 'New title',
        label: ['auth', 'urgent'].join(REPEATED_FLAG_SEPARATOR),
        priority: 'high',
        assignee: 'console-w2',
        'assignee-kind': 'console'
      })
    )
    expect(callMock.mock.calls[0]).toEqual([
      'tasks.update',
      {
        id: 't1',
        by: 'adam',
        title: 'New title',
        description: undefined,
        labels: ['auth', 'urgent'],
        priority: 'high',
        assignee: { id: 'console-w2', kind: 'console', name: 'console-w2' }
      }
    ])
    expect(process.exitCode).toBeUndefined()
  })

  it('exits 3 when the board refuses (held by someone else)', async () => {
    callMock.mockResolvedValueOnce({ result: { ok: false, reason: 'held-by:console-w1' } })
    await TASK_HANDLERS['tasks update'](ctx({ id: 't1', by: 'adam', title: 'x' }))
    expect(process.exitCode).toBe(3)
  })

  it('refuses --assignee-kind without --assignee and a bad priority before calling', async () => {
    await expect(
      TASK_HANDLERS['tasks update'](ctx({ id: 't1', by: 'adam', 'assignee-kind': 'console' }))
    ).rejects.toThrow(/need --assignee/)
    await expect(
      TASK_HANDLERS['tasks update'](ctx({ id: 't1', by: 'adam', priority: 'now' }))
    ).rejects.toThrow(/--priority must be one of/)
    expect(callMock).not.toHaveBeenCalled()
  })
})

describe('dobius tasks move', () => {
  it('maps --to and --index to tasks.move', async () => {
    callMock.mockResolvedValueOnce({ result: { ok: true, task: okTask } })
    await TASK_HANDLERS['tasks move'](ctx({ id: 't1', by: 'adam', to: 'review', index: '0' }))
    expect(callMock.mock.calls[0]).toEqual([
      'tasks.move',
      { id: 't1', by: 'adam', to: 'review', index: 0 }
    ])
  })

  it('refuses done, in-progress, a missing --to and a bad --index without calling', async () => {
    const cases: Record<string, string>[] = [
      { id: 't1', by: 'adam', to: 'done' },
      { id: 't1', by: 'adam', to: 'in-progress' },
      { id: 't1', by: 'adam' },
      { id: 't1', by: 'adam', to: 'todo', index: '-1' }
    ]
    for (const flags of cases) {
      await expect(TASK_HANDLERS['tasks move'](ctx(flags))).rejects.toThrow()
    }
    expect(callMock).not.toHaveBeenCalled()
  })

  it('exits 3 on a refusal from the board', async () => {
    callMock.mockResolvedValueOnce({ result: { ok: false, reason: 'agent-dispatch' } })
    await TASK_HANDLERS['tasks move'](ctx({ id: 't1', by: 'adam', to: 'todo' }))
    expect(process.exitCode).toBe(3)
  })
})

describe('dobius tasks update labels', () => {
  it('refuses a bare or empty --label instead of wiping every label', async () => {
    const cases: Map<string, string | boolean>[] = [
      new Map<string, string | boolean>([['id', 't1'], ['by', 'adam'], ['label', true]]),
      new Map<string, string | boolean>([['id', 't1'], ['by', 'adam'], ['label', '']]),
      new Map<string, string | boolean>([
        ['id', 't1'],
        ['by', 'adam'],
        ['label', ['auth', ''].join(REPEATED_FLAG_SEPARATOR)]
      ])
    ]
    for (const flags of cases) {
      await expect(
        TASK_HANDLERS['tasks update']({ flags, client: { call: callMock, isRemote: false }, cwd, json: true } as never)
      ).rejects.toThrow(/Every --label needs a value/)
    }
    expect(callMock).not.toHaveBeenCalled()
  })

  it('--clear-labels sends an empty list; with --label it is refused', async () => {
    callMock.mockResolvedValueOnce({ result: { ok: true, task: okTask } })
    const flags = new Map<string, string | boolean>([['id', 't1'], ['by', 'adam'], ['clear-labels', true]])
    await TASK_HANDLERS['tasks update']({ flags, client: { call: callMock, isRemote: false }, cwd, json: true } as never)
    expect(callMock.mock.calls[0]?.[1]).toMatchObject({ labels: [] })
    flags.set('label', 'x')
    await expect(
      TASK_HANDLERS['tasks update']({ flags, client: { call: callMock, isRemote: false }, cwd, json: true } as never)
    ).rejects.toThrow(/either --label or --clear-labels/)
  })
})

describe('dobius tasks update label parsing (through parseArgs)', () => {
  it('a bare --label between valued ones is refused, not silently dropped', async () => {
    const { parseArgs } = await import('../args')
    const { flags } = parseArgs(['tasks', 'update', '--id', 't1', '--by', 'adam', '--label', 'old', '--label', '--label', 'new'])
    await expect(
      TASK_HANDLERS['tasks update']({ flags, client: { call: callMock, isRemote: false }, cwd, json: true } as never)
    ).rejects.toThrow(/Every --label needs a value/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('--clear-labels=true is refused instead of doing nothing', async () => {
    const { parseArgs } = await import('../args')
    const { flags } = parseArgs(['tasks', 'update', '--id', 't1', '--by', 'adam', '--clear-labels=true'])
    await expect(
      TASK_HANDLERS['tasks update']({ flags, client: { call: callMock, isRemote: false }, cwd, json: true } as never)
    ).rejects.toThrow(/--clear-labels takes no value/)
  })
})
