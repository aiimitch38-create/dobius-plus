import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type * as ChildProcessModule from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomAgent } from '../../shared/agents'

const mocks = vi.hoisted(() => ({
  command: 'codex',
  fakeChild: null as unknown
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  return {
    ...actual,
    spawn: vi.fn((...spawnArgs: Parameters<typeof actual.spawn>) =>
      mocks.fakeChild ? mocks.fakeChild : actual.spawn(...spawnArgs)
    )
  }
})
vi.mock('../codex-cli/command', () => ({ resolveCodexCommand: () => mocks.command }))
vi.mock('./agent-run-prompt', () => ({ buildSystemPrompt: () => '' }))

import { spawn } from 'node:child_process'
import {
  codexErrorFromLine,
  codexMessageFromLine,
  startCodexAgentProcess,
  unwrapCodexErrorMessage
} from './codex-agent-execution'

// Fixtures captured live: `echo "say hello" | codex exec --json --skip-git-repo-check
// --sandbox workspace-write --model totally-invalid-model-xyz -` (2026-09-04, Edith
// diagnosis). Before this fix, none of these lines were ever read on a failed run —
// a non-zero exit with empty stderr fell back to the opaque "Codex exited with code N".
describe('codexErrorFromLine', () => {
  it('extracts the message from a top-level error event', () => {
    const line =
      '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'totally-invalid-model-xyz\' model is not supported when using Codex with a ChatGPT account.\\"}}"}'
    expect(codexErrorFromLine(line)).toBe(
      "The 'totally-invalid-model-xyz' model is not supported when using Codex with a ChatGPT account."
    )
  })

  it('extracts the message from a turn.failed event', () => {
    const line =
      '{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'totally-invalid-model-xyz\' model is not supported when using Codex with a ChatGPT account.\\"}}"}}'
    expect(codexErrorFromLine(line)).toBe(
      "The 'totally-invalid-model-xyz' model is not supported when using Codex with a ChatGPT account."
    )
  })

  it('returns null for non-error event types', () => {
    expect(codexErrorFromLine('{"type":"thread.started","thread_id":"x"}')).toBeNull()
    expect(codexErrorFromLine('{"type":"turn.completed","usage":{}}')).toBeNull()
    expect(
      codexErrorFromLine('{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}')
    ).toBeNull()
  })

  it('returns null for malformed JSON instead of throwing', () => {
    expect(codexErrorFromLine('not json')).toBeNull()
    expect(codexErrorFromLine('')).toBeNull()
  })
})

describe('unwrapCodexErrorMessage', () => {
  it('unwraps a JSON-encoded nested error.message', () => {
    expect(
      unwrapCodexErrorMessage(
        '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"the real reason"}}'
      )
    ).toBe('the real reason')
  })

  it('returns the original string when it is not JSON', () => {
    expect(unwrapCodexErrorMessage('a plain error string')).toBe('a plain error string')
  })

  it('returns the original string when JSON but has no nested message', () => {
    expect(unwrapCodexErrorMessage('{"type":"error"}')).toBe('{"type":"error"}')
  })
})

describe('codexMessageFromLine (unchanged behavior, guarding against regressions in this file)', () => {
  it('still extracts the agent_message text', () => {
    expect(
      codexMessageFromLine('{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}')
    ).toBe('hello')
  })

  it('still ignores an error item', () => {
    expect(
      codexMessageFromLine('{"type":"item.completed","item":{"type":"error","message":"x"}}')
    ).toBeNull()
  })
})

class FakeCodexChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  kill = vi.fn(() => true)
}

const agent = {
  id: 'edith',
  name: 'Edith',
  engine: 'codex',
  model: 'gpt-5-codex',
  systemPrompt: '',
  bypassPermissions: false
} as CustomAgent

function startFake(overrides: { maxSteps?: number; cancelled?: () => boolean } = {}) {
  const child = new FakeCodexChild()
  mocks.fakeChild = child
  const onFinish = vi.fn()
  startCodexAgentProcess({
    agent,
    prompt: 'go',
    cwd: '/repo',
    codexHome: null,
    maxSteps: overrides.maxSteps ?? 100,
    onAssistantText: vi.fn(),
    onFinish,
    isCancelled: overrides.cancelled ?? (() => false)
  })
  return { child, onFinish }
}

function commandLine(id: string, phase: 'started' | 'completed' = 'started'): string {
  return `${JSON.stringify({ type: `item.${phase}`, item: { id, type: 'command_execution' } })}\n`
}

afterEach(() => {
  mocks.fakeChild = null
  mocks.command = 'codex'
  vi.mocked(spawn).mockClear()
})

describe('startCodexAgentProcess run policy', () => {
  it('spawns the resolved Codex CLI, not a bare `codex`', () => {
    mocks.command = '/opt/tools/bin/codex'
    startFake()
    expect(vi.mocked(spawn).mock.calls[0]?.[0]).toBe('/opt/tools/bin/codex')
  })

  it('turns off Codex multi-agent so sub-agents cannot escape the step cap', () => {
    startFake()
    const commandArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
    const flag = commandArgs.indexOf('--disable')
    expect(flag).toBeGreaterThan(-1)
    expect(commandArgs[flag + 1]).toBe('multi_agent')
  })

  it('counts multi-agent collab_tool_call items as tool steps', () => {
    const { child, onFinish } = startFake({ maxSteps: 1 })
    const collab = (id: string) =>
      `${JSON.stringify({ type: 'item.started', item: { id, type: 'collab_tool_call' } })}\n`
    child.stdout.write(collab('x') + collab('y'))
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('close', null)
    expect(onFinish.mock.calls).toEqual([
      ['error', 'Codex run stopped: it exceeded its limit of 1 tool steps.']
    ])
  })

  it('stops the run once it exceeds its tool-step cap and settles one error', () => {
    const { child, onFinish } = startFake({ maxSteps: 2 })
    child.stdout.write(commandLine('a') + commandLine('a', 'completed') + commandLine('b'))
    expect(child.kill).not.toHaveBeenCalled()
    child.stdout.write(commandLine('c'))
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    child.emit('close', null)
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onFinish).toHaveBeenCalledWith(
      'error',
      'Codex run stopped: it exceeded its limit of 2 tool steps.'
    )
  })

  it('does not count assistant messages as tool steps', () => {
    const { child, onFinish } = startFake({ maxSteps: 0 })
    child.stdout.write(
      '{"type":"item.completed","item":{"id":"m","type":"agent_message","text":"done"}}\n'
    )
    child.emit('close', 0)
    expect(child.kill).not.toHaveBeenCalled()
    expect(onFinish).toHaveBeenCalledWith('success', 'done')
  })

  it('settles exactly once on success, error-then-close and cancel', () => {
    const success = startFake()
    success.child.emit('close', 0)
    success.child.emit('close', 0)
    expect(success.onFinish.mock.calls).toEqual([['success', 'Codex completed the task.']])

    const failed = startFake()
    failed.child.emit('error', new Error('spawn codex ENOENT'))
    failed.child.emit('close', -2)
    expect(failed.onFinish.mock.calls).toEqual([['error', 'spawn codex ENOENT']])

    const cancelled = startFake({ cancelled: () => true })
    cancelled.child.emit('close', null)
    expect(cancelled.onFinish.mock.calls).toEqual([['cancelled', 'stopped by user']])
  })

  it('reports a stdin EPIPE as one failed run, never a success', () => {
    const { child, onFinish } = startFake()
    child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    child.emit('close', 0)
    expect(onFinish.mock.calls).toEqual([
      ['error', 'Codex did not receive the prompt: write EPIPE']
    ])
  })
})

describe('startCodexAgentProcess with a real child process', () => {
  const originalPath = process.env.PATH
  afterEach(() => {
    process.env.PATH = originalPath
  })

  function startReal(command: string, prompt: string) {
    mocks.command = command
    // Why: even if command resolution regresses to a bare `codex`, these tests
    // must never reach a real (paid, networked) Codex CLI on this machine.
    process.env.PATH = '/nonexistent/dobius-test'
    return new Promise<unknown[][]>((resolve) => {
      const onFinish = vi.fn()
      const child = startCodexAgentProcess({
        agent,
        prompt,
        cwd: process.cwd(),
        codexHome: null,
        maxSteps: 100,
        onAssistantText: vi.fn(),
        onFinish,
        isCancelled: () => false
      })
      child.once('close', () => setTimeout(() => resolve(onFinish.mock.calls), 50))
    })
  }

  it('turns a missing Codex CLI (ENOENT) into one failed run with no uncaught stream error', async () => {
    const calls = await startReal('/nonexistent/dobius-test/codex', 'go')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe('error')
    expect(String(calls[0]?.[1])).toContain('ENOENT')
  })

  it.skipIf(process.platform === 'win32')(
    'turns an early exit that breaks stdin (EPIPE) into one failed run',
    async () => {
      const calls = await startReal('/usr/bin/true', 'x'.repeat(4 * 1024 * 1024))
      expect(calls).toHaveLength(1)
      expect(calls[0]?.[0]).toBe('error')
    }
  )
})
