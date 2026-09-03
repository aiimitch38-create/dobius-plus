import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomHarnessDefinition } from '../../../shared/agents'
import { CustomHarnessProvider, validateCustomHarnessDefinition } from './custom-harness-provider'

const identityStoreMock = vi.hoisted(() => ({
  ensureAgentIdentity: vi.fn()
}))

vi.mock('../agent-participant-identity-store', () => identityStoreMock)

const SECRET_ENV = 'super-secret-env-value'

function makeDefinition(overrides: Partial<CustomHarnessDefinition> = {}): CustomHarnessDefinition {
  return {
    id: 'goose',
    label: 'Goose',
    command: '/usr/local/bin/goose',
    args: ['acp'],
    env: { GOOSE_TOKEN: SECRET_ENV },
    installInstructionsUrl: '',
    installHint: '',
    ...overrides
  }
}

type FakeChild = EventEmitter & {
  stdin: { write: (data: string, cb?: (error?: Error) => void) => void }
  stdout: EventEmitter
  stderr: EventEmitter
  kill: (signal?: string) => void
  exitCode: number | null
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = {
    write: vi.fn((_data: string, cb?: (error?: Error) => void) => {
      cb?.()
    })
  }
  child.kill = vi.fn(() => {
    child.exitCode = null
  })
  child.exitCode = null
  return child
}

function setup(definition = makeDefinition()) {
  const child = makeFakeChild()
  const spawn = vi.fn(() => child)
  const provider = new CustomHarnessProvider(definition, { spawn })
  return { provider, spawn, child }
}

beforeEach(() => {
  identityStoreMock.ensureAgentIdentity.mockReset()
  identityStoreMock.ensureAgentIdentity.mockReturnValue({ pubkey: 'harness-pubkey-hex' })
})

describe('custom harness validation', () => {
  it('accepts an absolute command path', () => {
    expect(() => validateCustomHarnessDefinition(makeDefinition())).not.toThrow()
  })

  it('accepts a bare command resolvable on PATH', () => {
    expect(() =>
      validateCustomHarnessDefinition(makeDefinition({ command: 'goose' }))
    ).not.toThrow()
  })

  it('rejects an empty command', () => {
    expect(() => validateCustomHarnessDefinition(makeDefinition({ command: '   ' }))).toThrow(
      /needs a command/
    )
  })

  it('rejects a relative path command', () => {
    expect(() =>
      validateCustomHarnessDefinition(makeDefinition({ command: './bin/goose' }))
    ).toThrow(/absolute path or a command resolvable on PATH/)
  })

  it('rejects a null byte in the command', () => {
    expect(() =>
      validateCustomHarnessDefinition(makeDefinition({ command: '/bin/goose\x00' }))
    ).toThrow(/null bytes/)
  })

  it('rejects a null byte in args', () => {
    expect(() =>
      validateCustomHarnessDefinition(makeDefinition({ args: ['ok', 'bad\x00arg'] }))
    ).toThrow(/null bytes/)
  })

  it('rejects a null byte in env keys and values', () => {
    expect(() =>
      validateCustomHarnessDefinition(makeDefinition({ env: { 'BAD\x00KEY': 'v' } }))
    ).toThrow(/null bytes/)
    expect(() =>
      validateCustomHarnessDefinition(makeDefinition({ env: { KEY: 'bad\x00value' } }))
    ).toThrow(/null bytes/)
  })
})

describe('custom harness provider', () => {
  it('launch spawns the stored command and args with the stored env merged in', async () => {
    const { provider, spawn } = setup()

    await provider.launch({ agentId: provider.agentId, prompt: 'hello', cwd: '/tmp/w' })

    expect(spawn).toHaveBeenCalledWith(
      '/usr/local/bin/goose',
      ['acp'],
      expect.objectContaining({
        cwd: '/tmp/w',
        env: expect.objectContaining({ GOOSE_TOKEN: SECRET_ENV })
      })
    )
    // The app environment still reaches the child alongside the stored env.
    const envArgument = spawn.mock.calls[0][2].env as Record<string, string>
    expect(envArgument.PATH).toBeDefined()
  })

  it('launch binds a Nostr participant identity keyed to this harness instance', async () => {
    const { provider } = setup()

    const result = await provider.launch({
      agentId: `custom-harness-${provider.agentId}`,
      prompt: 'hello'
    })

    expect(identityStoreMock.ensureAgentIdentity).toHaveBeenCalledWith(
      'custom-harness-goose'
    )
    expect(result.identityPubkey).toBe('harness-pubkey-hex')
  })

  it('keeps env values write-only: no read path returns or logs them', async () => {
    const { provider, spawn, child } = setup()
    const events: unknown[] = []
    provider.subscribe((event) => events.push(event))

    const result = await provider.launch({ agentId: provider.agentId, prompt: 'hi' })
    child.stdout.emit('data', Buffer.from('line one\nline two\n'))
    child.emit('close', 0)
    const snapshot = provider.status()

    // The write-only proof: the spawn call DID receive the secret...
    expect(JSON.stringify(spawn.mock.calls[0])).toContain(SECRET_ENV)
    // ...and none of the observable surfaces did.
    for (const surface of [JSON.stringify(result), JSON.stringify(snapshot), JSON.stringify(events)]) {
      expect(surface).not.toContain(SECRET_ENV)
    }
  })

  it('refuses a second launch while the first process is still alive', async () => {
    const { provider } = setup()

    await provider.launch({ agentId: provider.agentId, prompt: 'one' })
    await expect(provider.launch({ agentId: provider.agentId, prompt: 'two' })).rejects.toThrow(
      /already running/
    )
  })

  it('send pipes the prompt into stdin as a line', async () => {
    const { provider, child } = setup()
    await provider.launch({ agentId: provider.agentId, prompt: 'first' })

    await provider.send('second')

    expect(child.stdin.write).toHaveBeenCalledWith('first\n', expect.any(Function))
    expect(child.stdin.write).toHaveBeenLastCalledWith('second\n', expect.any(Function))
  })

  it('send throws once the harness process has exited', async () => {
    const { provider, child } = setup()
    await provider.launch({ agentId: provider.agentId, prompt: 'hello' })
    child.emit('close', 0)

    await expect(provider.send('again')).rejects.toThrow(/not running/)
  })

  it('streams stdout lines as run events and marks clean exits finished', async () => {
    const { provider, child } = setup()
    const events: unknown[] = []
    provider.subscribe((event) => events.push(event))

    await provider.launch({ agentId: provider.agentId, prompt: 'hello' })
    child.stdout.emit('data', Buffer.from('partial'))
    child.stdout.emit('data', Buffer.from(' tail\nwhole line\n'))
    child.emit('close', 0)

    const runEvents = events.flatMap((event) =>
      typeof event === 'object' && event !== null && 'kind' in event && event.kind === 'run-event'
        ? [event.event]
        : []
    )
    expect(runEvents.map((event) => event.detail)).toEqual(['partial tail', 'whole line'])
    expect(provider.status().state).toBe('finished')
  })

  it('marks non-zero exits failed with the exit code', async () => {
    const { provider, child } = setup()
    await provider.launch({ agentId: provider.agentId, prompt: 'hello' })

    child.stderr.emit('data', Buffer.from('boom\n'))
    child.emit('close', 2)

    expect(provider.status().state).toBe('failed')
    expect(provider.status().detail).toContain('exited with code 2')
  })

  it('cancel sends SIGTERM to the live process and is a no-op when idle', async () => {
    const { provider, child } = setup()
    await provider.launch({ agentId: provider.agentId, prompt: 'hello' })

    await provider.cancel()

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    const idle = setup()
    await expect(idle.provider.cancel()).resolves.toBeUndefined()
    expect(idle.child.kill).not.toHaveBeenCalled()
  })
})
