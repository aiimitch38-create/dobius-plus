import { describe, expect, it } from 'vitest'
import {
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
