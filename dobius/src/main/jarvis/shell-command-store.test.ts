import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCommandArgs } from './agent-context'
import { ShellCommandStore, describeForAgent, runArgv } from './shell-command-store'

function scratch(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'shellstore-')), name)
}

describe('ShellCommandStore — read-only commands', () => {
  it('runs a read-only command immediately and returns its output', async () => {
    const store = new ShellCommandStore()
    const result = await store.propose(['echo', 'hello'])
    expect(result.kind).toBe('ran')
    if (result.kind !== 'ran') {
      throw new Error('expected the command to run')
    }
    expect(result.output).toBe('hello')
    expect(store.pendingCount()).toBe(0)
  })

  it('truncates real runner output at 4000 characters', async () => {
    const output = await runArgv(['echo', 'y'.repeat(9_000)])
    expect(output).toHaveLength(4_000)
  })

  it('reports a failing command by its output rather than throwing', async () => {
    const output = await runArgv(['ls', '/definitely/not/here'])
    expect(output.length).toBeGreaterThan(0)
  })
})

describe('ShellCommandStore — writing commands need a human (invariant A)', () => {
  it('queues a writing command WITHOUT executing it', async () => {
    const target = scratch('unapproved')
    const store = new ShellCommandStore()

    const result = await store.propose(['touch', target], 'make a file')

    expect(result.kind).toBe('queued')
    expect(store.pendingCount()).toBe(1)
    // The side effect is the assertion. A rejected promise would prove nothing:
    // the question is whether anything ran, not whether the caller was told no.
    expect(existsSync(target)).toBe(false)
  })

  it('DOES create the file once approved, so the test above gates a real command', async () => {
    const target = scratch('approved')
    const store = new ShellCommandStore()

    const proposed = await store.propose(['touch', target])
    if (proposed.kind !== 'queued') {
      throw new Error('expected the command to be queued')
    }
    expect(existsSync(target)).toBe(false)

    const ran = await store.runApproved(proposed.command.id)
    expect(ran.ok).toBe(true)
    expect(existsSync(target)).toBe(true)
  })

  it('never tells the agent the id, so no client tool can approve anything', async () => {
    const store = new ShellCommandStore()
    const result = await store.propose(['mv', '/tmp/a', '/tmp/b'])
    if (result.kind !== 'queued') {
      throw new Error('expected the command to be queued')
    }
    const spoken = describeForAgent(result)
    expect(spoken).not.toContain(result.command.id)
    expect(spoken).toContain('mv /tmp/a /tmp/b')
  })

  it('cannot run the same approval twice', async () => {
    const store = new ShellCommandStore()
    const proposed = await store.propose(['touch', scratch('once')])
    if (proposed.kind !== 'queued') {
      throw new Error('expected the command to be queued')
    }
    expect((await store.runApproved(proposed.command.id)).ok).toBe(true)
    expect((await store.runApproved(proposed.command.id)).ok).toBe(false)
  })

  it('refuses an unknown id', async () => {
    const store = new ShellCommandStore()
    expect((await store.runApproved('shell_999')).ok).toBe(false)
  })

  it('cannot run a discarded command', async () => {
    const target = scratch('discarded')
    const store = new ShellCommandStore()
    const proposed = await store.propose(['touch', target])
    if (proposed.kind !== 'queued') {
      throw new Error('expected the command to be queued')
    }
    expect(store.discard(proposed.command.id)).toBe(true)
    expect((await store.runApproved(proposed.command.id)).ok).toBe(false)
    expect(existsSync(target)).toBe(false)
  })
})

describe('ShellCommandStore — denied commands', () => {
  it('does not queue a denied command at all', async () => {
    const store = new ShellCommandStore()
    const result = await store.propose(['sudo', 'rm', '-rf', '/'])
    expect(result.kind).toBe('denied')
    // Not merely un-runnable: never in the queue, so the window never offers it.
    expect(store.pendingCount()).toBe(0)
  })

  it('does not queue a write into the plugin directory (invariant B)', async () => {
    const pluginDir = '/Users/x/Library/Application Support/dobius-plus/adam-plugins'
    const store = new ShellCommandStore({ pluginDir })
    const result = await store.propose(['cp', '/tmp/evil.mjs', `${pluginDir}/evil.mjs`])
    expect(result.kind).toBe('denied')
    expect(store.pendingCount()).toBe(0)
  })

  it('tells the agent why, so it can say so rather than retrying', async () => {
    const store = new ShellCommandStore()
    const result = await store.propose(['shutdown', '-h', 'now'])
    expect(describeForAgent(result)).toContain('Refused')
  })
})

describe('the jarvis:proposeShell boundary', () => {
  // The handler is `parseCommandArgs(String(command ?? ''))` -> store.propose.
  // These cover that composition; the handler itself needs electron to import.
  const proposeFrom = async (command: unknown, store: ShellCommandStore): Promise<string> => {
    const argv = parseCommandArgs(typeof command === 'string' ? command : String(command ?? ''))
    return describeForAgent(await store.propose(argv, 'Adam asked to run this.'))
  }

  it('runs a read-only command and speaks its output', async () => {
    expect(await proposeFrom('echo hello', new ShellCommandStore())).toBe('hello')
  })

  it('never speaks the pending id for a writing command', async () => {
    const store = new ShellCommandStore()
    const spoken = await proposeFrom(`touch ${scratch('viaipc')}`, store)
    expect(spoken).not.toMatch(/shell_\d+/)
    expect(spoken).toMatch(/approval/i)
    expect(store.pendingCount()).toBe(1)
  })

  it('coerces a non-string command instead of throwing', async () => {
    const store = new ShellCommandStore()
    // The classifier is a pure function over strings on purpose; this boundary
    // is where model-supplied junk is made safe.
    await expect(proposeFrom(null, store)).resolves.toBeTypeOf('string')
    await expect(proposeFrom(42, store)).resolves.toBeTypeOf('string')
    await expect(proposeFrom(undefined, store)).resolves.toBeTypeOf('string')
  })

  it('honours quoted arguments containing spaces', async () => {
    const store = new ShellCommandStore()
    await proposeFrom('mv "/tmp/a b.txt" /tmp/c', store)
    const pending = store.get('shell_1')
    expect(pending?.argv).toEqual(['mv', '/tmp/a b.txt', '/tmp/c'])
  })

  it('refuses a denied command without queueing it', async () => {
    const store = new ShellCommandStore()
    expect(await proposeFrom('sudo rm -rf /', store)).toMatch(/Refused/)
    expect(store.pendingCount()).toBe(0)
  })
})
