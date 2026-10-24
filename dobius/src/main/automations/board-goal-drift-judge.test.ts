import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { judgeBoardGoalDrift } from './board-goal-drift-judge'
import { GOAL_JUDGE_ARGS } from './loop-goal-judge'

vi.mock('../codex-cli/command', () => ({ resolveClaudeCommand: () => '/fake/claude' }))

type FakeChild = EventEmitter & { stdin: PassThrough; stdout: PassThrough; kill: () => void }

/** Mocked child process: no real agent CLI is launched. */
function fakeSpawn(stdout: string, code = 0) {
  const calls: { args: string[]; input: string }[] = []
  const fn = vi.fn((_command: string, args: string[]) => {
    const child = new EventEmitter() as FakeChild
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.kill = vi.fn()
    const call = { args, input: '' }
    calls.push(call)
    child.stdin.on('data', (chunk: Buffer) => {
      call.input += chunk.toString()
    })
    child.stdin.on('finish', () => {
      child.stdout.end(stdout)
      setImmediate(() => child.emit('close', code))
    })
    return child
  })
  return { spawn: fn as unknown as typeof spawn, calls }
}

const input = { goalBlock: 'Main goal: Ship login', consoleName: 'Claude 2', report: 'Did billing' }

describe('judgeBoardGoalDrift', () => {
  it('runs the locked-down judge (same flags as loop goals) and returns the reason', async () => {
    const fake = fakeSpawn('OFF GOAL: worked on billing\n')
    await expect(judgeBoardGoalDrift(input, { spawn: fake.spawn })).resolves.toEqual({
      verdict: 'off-goal',
      reason: 'worked on billing',
      error: null
    })
    expect(fake.calls[0].args).toEqual([...GOAL_JUDGE_ARGS])
    expect(fake.calls[0].input).toContain('Main goal: Ship login')
    expect(fake.calls[0].input).toContain('Did billing')
  })

  it('reports an unclear answer and a failed run without a verdict', async () => {
    await expect(
      judgeBoardGoalDrift(input, { spawn: fakeSpawn('hmm').spawn })
    ).resolves.toMatchObject({ verdict: null, error: 'Judge gave no clear answer.' })
    await expect(
      judgeBoardGoalDrift(input, { spawn: fakeSpawn('', 2).spawn })
    ).resolves.toMatchObject({ verdict: null, error: 'Judge exited with code 2.' })
  })

  it('refuses malformed requests without spawning anything', async () => {
    const fake = fakeSpawn('ON GOAL')
    await expect(
      judgeBoardGoalDrift({ goalBlock: '  ', consoleName: 'x', report: '' }, { spawn: fake.spawn })
    ).resolves.toMatchObject({ verdict: null, error: 'Invalid drift check request.' })
    expect(fake.calls).toHaveLength(0)
  })
})
