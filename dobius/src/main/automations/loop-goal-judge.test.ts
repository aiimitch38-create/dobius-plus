import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { spawn } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GOAL_JUDGE_ARGS, createClaudeGoalJudge } from './loop-goal-judge'

vi.mock('../codex-cli/command', () => ({ resolveClaudeCommand: () => '/fake/claude' }))

type FakeChild = EventEmitter & {
  stdin: PassThrough
  stdout: PassThrough
  kill: ReturnType<typeof vi.fn>
  stdinText: () => string
}

/** A mocked child process: no real agent CLI is ever launched in these tests. */
function fakeSpawn() {
  const children: FakeChild[] = []
  const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = []
  const fn = vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
    const child = new EventEmitter() as FakeChild
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    let input = ''
    child.stdin.on('data', (chunk: Buffer) => {
      input += chunk.toString()
    })
    child.stdinText = () => input
    child.kill = vi.fn()
    children.push(child)
    calls.push({ command, args, options })
    return child
  })
  return { spawn: fn as unknown as typeof spawn, children, calls }
}

function answer(child: FakeChild, stdout: string, code = 0): void {
  child.stdout.end(stdout)
  setImmediate(() => child.emit('close', code))
}

describe('createClaudeGoalJudge', () => {
  afterEach(() => vi.useRealTimers())

  it('runs a one-shot, tool-less, read-only claude process and parses MET', async () => {
    const fake = fakeSpawn()
    const judge = createClaudeGoalJudge({ spawn: fake.spawn, cwd: '/tmp/judge' })
    const pending = judge({ goal: 'All tests pass', transcript: ['12 passed'] })
    const [child] = fake.children
    answer(child, 'Looking at it.\nMET\n')
    await expect(pending).resolves.toEqual({ verdict: 'met', error: null })

    const [call] = fake.calls
    expect(call.command).toBe('/fake/claude')
    expect(call.args).toEqual([...GOAL_JUDGE_ARGS])
    expect(call.args).toContain('-p')
    expect(call.args[call.args.indexOf('--tools') + 1]).toBe('')
    expect(call.args[call.args.indexOf('--permission-mode') + 1]).toBe('plan')
    expect(call.args).toContain('--strict-mcp-config')
    expect(call.options).toMatchObject({ cwd: '/tmp/judge', shell: false })
    expect(child.stdinText()).toContain('GOAL: All tests pass')
    expect(child.stdinText()).toContain('12 passed')
  })

  it('parses NOT MET', async () => {
    const fake = fakeSpawn()
    const pending = createClaudeGoalJudge({ spawn: fake.spawn })({ goal: 'g', transcript: [] })
    answer(fake.children[0], 'NOT MET')
    await expect(pending).resolves.toEqual({ verdict: 'not-met', error: null })
  })

  it('reports an unclear answer without a verdict', async () => {
    const fake = fakeSpawn()
    const pending = createClaudeGoalJudge({ spawn: fake.spawn })({ goal: 'g', transcript: [] })
    answer(fake.children[0], 'Probably fine?')
    await expect(pending).resolves.toEqual({ verdict: null, error: 'Judge gave no clear answer.' })
  })

  it('reports a non-zero exit', async () => {
    const fake = fakeSpawn()
    const pending = createClaudeGoalJudge({ spawn: fake.spawn })({ goal: 'g', transcript: [] })
    answer(fake.children[0], 'MET', 1)
    await expect(pending).resolves.toEqual({ verdict: null, error: 'Judge exited with code 1.' })
  })

  it('kills the judge when it outlives the timeout', async () => {
    vi.useFakeTimers()
    const fake = fakeSpawn()
    const pending = createClaudeGoalJudge({ spawn: fake.spawn, timeoutMs: 1_000 })({
      goal: 'g',
      transcript: []
    })
    vi.advanceTimersByTime(1_000)
    await expect(pending).resolves.toEqual({ verdict: null, error: 'Judge timed out after 1s.' })
    expect(fake.children[0].kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('reports a spawn failure (CLI missing) instead of throwing', async () => {
    const fake = fakeSpawn()
    const pending = createClaudeGoalJudge({ spawn: fake.spawn })({ goal: 'g', transcript: [] })
    fake.children[0].emit('error', new Error('spawn ENOENT'))
    await expect(pending).resolves.toEqual({
      verdict: null,
      error: 'Judge could not start: spawn ENOENT'
    })
  })
})
