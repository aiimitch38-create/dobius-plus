import { describe, expect, it } from 'vitest'
import {
  CONTEXT_BUDGET_CHARS,
  MAX_MEMORY_CHARS,
  composeAgentContext,
  decideDobiusCommand,
  formatTerminalTabs,
  parseCommandArgs,
  parseCommandGroups
} from './agent-context'

const GROUPS = new Set(['worktree', 'terminal', 'goto', 'screenshot'])

describe('parseCommandGroups', () => {
  it('reads groups out of the CLI help text', () => {
    const help = [
      'Usage: dobius <command> [options]',
      '',
      'Worktrees:',
      '  worktree list             List worktrees',
      '  terminal send             Send input',
      'Not a command line',
      '  --help                    Show help'
    ].join('\n')
    const groups = parseCommandGroups(help)
    expect(groups.has('worktree')).toBe(true)
    expect(groups.has('terminal')).toBe(true)
    expect(groups.has('--help')).toBe(false)
  })
})

describe('decideDobiusCommand', () => {
  it('allows a read command in an allowed group', () => {
    expect(decideDobiusCommand(['worktree', 'list'], GROUPS)).toEqual({ allowed: true })
  })

  it('refuses an unknown group', () => {
    expect(decideDobiusCommand(['rm', '-rf'], GROUPS).allowed).toBe(false)
  })

  it('refuses destructive verbs even in an allowed group', () => {
    for (const verb of ['rm', 'remove', 'reset', 'stop', 'close']) {
      expect(decideDobiusCommand(['worktree', verb], GROUPS).allowed).toBe(false)
    }
  })

  it('allows bare --help so discovery works', () => {
    expect(decideDobiusCommand(['--help'], GROUPS).allowed).toBe(true)
  })

  it('allows browser commands that the old hardcoded list hid', () => {
    expect(decideDobiusCommand(['goto', 'https://x'], GROUPS).allowed).toBe(true)
    expect(decideDobiusCommand(['screenshot'], GROUPS).allowed).toBe(true)
  })

  it('refuses an empty command', () => {
    expect(decideDobiusCommand([], GROUPS).allowed).toBe(false)
  })
})

describe('parseCommandArgs', () => {
  it('keeps quoted spans together', () => {
    expect(parseCommandArgs('terminal send --text "npm run build"')).toEqual([
      'terminal',
      'send',
      '--text',
      'npm run build'
    ])
  })
})

describe('formatTerminalTabs', () => {
  const listJson = JSON.stringify({
    result: {
      terminals: [
        { handle: 'term_a', title: 'OC | Greeting', worktreePath: '/repo/one', worktreeId: 'w1' },
        { handle: 'term_b', title: 'voice crashes', worktreePath: '/repo/one', worktreeId: 'w1' },
        { handle: 'term_c', title: 'Terminal 1', worktreePath: '/repo/two', worktreeId: 'w2' }
      ]
    }
  })

  it('numbers terminals per worktree so "terminal two" resolves', () => {
    const out = formatTerminalTabs(listJson)
    expect(out).toContain('Terminal 1: OC | Greeting')
    expect(out).toContain('Terminal 2: voice crashes')
    // Numbering restarts in the next worktree.
    expect(out).toContain('Terminal 1: Terminal 1')
  })

  it('gives a usable worktree selector', () => {
    expect(formatTerminalTabs(listJson)).toContain('"id:w1"')
  })

  it('says so when nothing is open', () => {
    expect(formatTerminalTabs(JSON.stringify({ result: { terminals: [] } }))).toBe(
      '(no terminals open)'
    )
  })

  it('falls back to the raw text if the JSON is unreadable', () => {
    expect(formatTerminalTabs('not json')).toBe('not json')
  })
})

describe('composeAgentContext — memory must not evict the machine state', () => {
  const machineState = [
    '## What the user was doing most recently (newest first)',
    'MOST RECENT: /Users/x/project',
    'building...',
    '',
    '## Open terminal tabs (numbered as the user counts them)',
    'Terminal 1: build'
  ].join('\n')

  it('returns the machine state unchanged when there is no memory', () => {
    expect(composeAgentContext('', machineState)).toBe(machineState)
  })

  it('keeps both blocks and stays inside the budget when memory is full', () => {
    // A memory at its own 2,200-char cap: the case the build file warns about.
    const memory = `## What I remember about the user\n${'m'.repeat(2_200)}`
    const result = composeAgentContext(memory, 'S'.repeat(20_000))

    expect(result.length).toBeLessThanOrEqual(CONTEXT_BUDGET_CHARS)
    expect(result).toContain('## What I remember about the user')
    // The regression: the terminal context must still be in the payload.
    expect(result).toContain('S')
    expect(result.split('S').length - 1).toBeGreaterThan(5_000)
  })

  it('never truncates the memory block itself', () => {
    const memory = `## What I remember about the user\nwife: Ashley`
    const result = composeAgentContext(memory, 'S'.repeat(20_000))
    expect(result.startsWith(memory)).toBe(true)
    expect(result).toContain('wife: Ashley')
  })

  it('still bounds the payload when memory alone exceeds the budget', () => {
    // This comment used to read "cannot happen in practice". It could: the key
    // was uncapped, so one remembered fact produced a 10,001-char block and a
    // 10,048-char payload with no machine state in it. AdamMemory now caps the
    // key, and this is the second line of defence for a hand-edited file.
    const result = composeAgentContext('m'.repeat(CONTEXT_BUDGET_CHARS + 500), machineState)
    expect(result.length).toBeLessThanOrEqual(CONTEXT_BUDGET_CHARS)
    expect(result).toContain('Terminal 1')
  })

  it('leaves the machine state at least half the budget however big memory is', () => {
    const result = composeAgentContext('m'.repeat(50_000), 'S'.repeat(20_000))
    expect(result.length).toBeLessThanOrEqual(CONTEXT_BUDGET_CHARS)
    expect(result.split('S').length - 1).toBeGreaterThanOrEqual(MAX_MEMORY_CHARS - 2)
  })
})
