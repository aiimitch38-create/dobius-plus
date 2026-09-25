import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AgentContext from './agent-context'

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void
type ExecStub = (file: string, args: string[], options: unknown, callback: ExecCallback) => void

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn<ExecStub>() }))

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

const HELP = ['Usage: dobius <command>', '', '  worktree list             List worktrees'].join('\n')

function helpFails(): void {
  execFileMock.mockImplementationOnce((_file, _args, _options, callback) =>
    callback(new Error('spawn dobius ENOENT'), '', '')
  )
}

function helpSucceeds(): void {
  execFileMock.mockImplementationOnce((_file, _args, _options, callback) =>
    callback(null, HELP, '')
  )
}

function commandPrints(output: string): void {
  execFileMock.mockImplementationOnce((_file, _args, _options, callback) =>
    callback(null, output, '')
  )
}

// Why a fresh module per test: the group cache is module state.
async function loadModule(): Promise<typeof AgentContext> {
  vi.resetModules()
  return import('./agent-context')
}

beforeEach(() => {
  execFileMock.mockReset()
})

describe('runDobiusCommand discovery (#87)', () => {
  it('does not cache a failed --help; the next command retries and runs', async () => {
    const { runDobiusCommand } = await loadModule()
    helpFails()
    const first = await runDobiusCommand('worktree list')
    expect(first).toMatch(/could not read the dobius command list/i)
    expect(execFileMock).toHaveBeenCalledTimes(1)

    helpSucceeds()
    commandPrints('wt-1  main')
    await expect(runDobiusCommand('worktree list')).resolves.toBe('wt-1  main')
    expect(execFileMock.mock.calls.map(([, args]) => args)).toEqual([
      ['--help'],
      ['--help'],
      ['worktree', 'list']
    ])
  })

  it('does not cache help that exited with an error', async () => {
    const { runDobiusCommand } = await loadModule()
    execFileMock.mockImplementationOnce((_file, _args, _options, callback) =>
      callback(new Error('exit 1'), HELP, 'Dobius is not running')
    )
    await expect(runDobiusCommand('worktree list')).resolves.toMatch(/nothing was run/i)
    helpSucceeds()
    commandPrints('ok')
    await expect(runDobiusCommand('worktree list')).resolves.toBe('ok')
  })

  it('caches a successful discovery', async () => {
    const { runDobiusCommand } = await loadModule()
    helpSucceeds()
    commandPrints('one')
    commandPrints('two')
    await runDobiusCommand('worktree list')
    await runDobiusCommand('worktree list')
    const helpCalls = execFileMock.mock.calls.filter(([, args]) => args[0] === '--help')
    expect(helpCalls).toHaveLength(1)
  })

  it('still refuses unknown groups once discovery succeeded', async () => {
    const { runDobiusCommand } = await loadModule()
    helpSucceeds()
    await expect(runDobiusCommand('nuke everything')).resolves.toBe(
      '"nuke" is not a dobius command.'
    )
  })
})
