import { describe, expect, it, vi } from 'vitest'
import {
  createRuntimeQuickHands,
  findTerminal,
  lastSpokenLine,
  matchQuickHand,
  runQuickHand,
  type QuickHandsDeps,
  type QuickHandsRuntime,
  type QuickTerminal
} from './live-voice-quick-hands'

const TERMINALS: QuickTerminal[] = [
  { handle: 'h1', name: 'Backend' },
  { handle: 'h2', name: '✳ Fix login bug' },
  { handle: 'h3', name: 'docs site' },
  { handle: 'h4', name: 'API server' },
  { handle: 'h5', name: 'API tests' },
  { handle: 'h6', name: 'readme' }
]

function fakeDeps(over: Partial<QuickHandsDeps> = {}): QuickHandsDeps & {
  typeInto: ReturnType<typeof vi.fn>
} {
  return {
    listTerminals: async () => TERMINALS,
    typeInto: vi.fn(async () => undefined),
    readTail: async () => ['first', '\u001b[32m✔ built in 2.1s\u001b[0m', '   ', '\u001b[2K'],
    weekUsage: async () => ({ costUsd: 12.5, sessions: 40 }),
    ...over
  } as QuickHandsDeps & { typeInto: ReturnType<typeof vi.fn> }
}

describe('matchQuickHand: list terminals', () => {
  it.each([
    'How many terminals are open?',
    'how many terminals do I have open',
    'Which terminals are open',
    'what terminals are running right now',
    'Hey Adam, how many terminals are there?',
    'Can you list my terminals please',
    'list the open terminals'
  ])('matches %s', (phrase) => {
    expect(matchQuickHand(phrase)).toEqual({ hand: 'list-terminals' })
  })
})

describe('matchQuickHand: type into a terminal', () => {
  it.each([
    ['type ls into backend', 'ls', 'backend', false],
    ['Type npm test in the API tests terminal', 'npm test', 'api tests', false],
    ['type "git status" into backend and press enter', 'git status', 'backend', true],
    ['Please type git pull into the docs site tab, and hit enter', 'git pull', 'docs site', true],
    ['type cd src in backend then send it', 'cd src', 'backend', true],
    ['type fix the bug in login into fix login bug', 'fix the bug in login', 'fix login bug', false]
  ])('matches %s', (phrase, text, target, enter) => {
    expect(matchQuickHand(phrase)).toEqual({ hand: 'type', text, target, enter })
  })

  it('keeps the original casing of the typed text', () => {
    expect(matchQuickHand('type ls -A into Backend')).toMatchObject({ text: 'ls -A' })
  })
})

describe('matchQuickHand: read a terminal', () => {
  it.each([
    ["what's backend doing", 'backend', false],
    ['What is the docs site terminal doing right now?', 'docs site', false],
    ['what is api server up to', 'api server', false],
    ['read the backend terminal', 'backend', false],
    ['read me the last line of the docs site', 'docs site', false],
    ["read backend's output", 'backend', false],
    ['read backend', 'backend', true]
  ])('matches %s', (phrase, target, exact) => {
    expect(matchQuickHand(phrase)).toEqual({ hand: 'read-terminal', target, exact })
  })
})

describe('matchQuickHand: usage', () => {
  it.each([
    ['how much have I spent today', true],
    ['How much did I spend?', false],
    ["what's my usage", false],
    ['what is my spend today', true],
    ['how much have we spent on claude this week', false],
    ['check my claude usage', false]
  ])('matches %s', (phrase, today) => {
    expect(matchQuickHand(phrase)).toEqual({ hand: 'usage', today })
  })
})

describe('matchQuickHand: goes to ADAM', () => {
  it.each([
    'type up a plan for the login page',
    'type out the steps in the readme',
    'type a summary into notes',
    'write ls into backend',
    'what is going on',
    "what's it doing",
    'what is that doing',
    'how many terminals should I open for this project',
    'open a new terminal',
    'close the backend terminal',
    'read the plan and tell me what you think about the login page',
    'how much would it cost to run this on AWS',
    'fix the login bug in backend',
    'type',
    ''
  ])('does not match %s', (phrase) => {
    expect(matchQuickHand(phrase)).toBeNull()
  })
})

describe('findTerminal', () => {
  it('matches whole words, case-insensitively, and refuses ambiguity', () => {
    expect(findTerminal(TERMINALS, 'backend')?.handle).toBe('h1')
    expect(findTerminal(TERMINALS, 'login bug')?.handle).toBe('h2')
    expect(findTerminal(TERMINALS, 'api')).toBeNull()
    expect(findTerminal(TERMINALS, 'back')).toBeNull()
    expect(findTerminal(TERMINALS, 'frontend')).toBeNull()
    expect(findTerminal(TERMINALS, 'docs', true)).toBeNull()
    expect(findTerminal(TERMINALS, 'docs site', true)?.handle).toBe('h3')
  })
})

describe('lastSpokenLine', () => {
  it('skips blank and escape-only lines and strips ANSI', () => {
    expect(lastSpokenLine(['a', '\u001b[32m✔ built\u001b[0m', '  ', '\u001b[2K'])).toBe('✔ built')
  })
  it('trims long lines to about 150 characters', () => {
    const line = lastSpokenLine(['x'.repeat(400)])
    expect(line?.length).toBe(150)
    expect(line?.endsWith('…')).toBe(true)
  })
  it('is null with no output', () => {
    expect(lastSpokenLine(['', '   '])).toBeNull()
  })
})

describe('runQuickHand', () => {
  it('counts terminals and names up to five', async () => {
    const result = await runQuickHand('how many terminals are open', fakeDeps())
    expect(result).toEqual({
      name: 'list-terminals',
      speak: '6 terminals are open: Backend, ✳ Fix login bug, docs site, API server, API tests, and 1 more.'
    })
  })

  it('types without Enter unless asked', async () => {
    const deps = fakeDeps()
    expect(await runQuickHand('type ls into backend', deps)).toEqual({
      name: 'type',
      speak: 'Typed it into Backend.'
    })
    expect(deps.typeInto).toHaveBeenCalledWith('h1', 'ls', false)
    await runQuickHand('type ls into backend and press enter', deps)
    expect(deps.typeInto).toHaveBeenLastCalledWith('h1', 'ls', true)
  })

  it('returns null (ADAM handles it) when the terminal is unknown or ambiguous', async () => {
    const deps = fakeDeps()
    expect(await runQuickHand('type ls into frontend', deps)).toBeNull()
    expect(await runQuickHand('type ls into api', deps)).toBeNull()
    expect(deps.typeInto).not.toHaveBeenCalled()
  })

  it('a bare "read X" needs the exact terminal name', async () => {
    const deps = fakeDeps()
    expect(await runQuickHand('read the readme', deps)).toEqual({
      name: 'read-terminal',
      speak: 'readme last showed: ✔ built in 2.1s'
    })
    expect(await runQuickHand('read docs', deps)).toBeNull()
  })

  it("reads a terminal's last line", async () => {
    expect(await runQuickHand("what's backend doing", fakeDeps())).toEqual({
      name: 'read-terminal',
      speak: 'Backend last showed: ✔ built in 2.1s'
    })
  })

  it('reports the week of usage and says when today is not tracked', async () => {
    expect((await runQuickHand('how much have I spent today', fakeDeps()))?.speak).toBe(
      'About $12.50 on Claude over the last 7 days, across 40 sessions. There is no separate total for today.'
    )
    expect(await runQuickHand("what's my usage", fakeDeps({ weekUsage: async () => null }))).toBeNull()
  })
})

describe('createRuntimeQuickHands', () => {
  function fakeRuntime(driver = 'idle'): QuickHandsRuntime & {
    sendTerminal: ReturnType<typeof vi.fn>
  } {
    return {
      listTerminals: async () => ({
        terminals: [
          { handle: 't1', title: 'Backend', branch: 'main' },
          { handle: 't2', title: null, branch: 'feature/x' }
        ] as never
      }),
      readTerminal: async (handle) => ({ handle, tail: ['ok'] }) as never,
      sendTerminal: vi.fn(async (_handle, _action, options) => {
        await options?.beforeWrite?.('pty-1')
      }),
      getDriver: () => ({ kind: driver })
    }
  }

  it('names terminals by title, else branch, and sends Enter separately', async () => {
    const runtime = fakeRuntime()
    const hands = createRuntimeQuickHands(() => runtime, async () => undefined)
    expect(await hands.listTerminals()).toEqual([
      { handle: 't1', name: 'Backend' },
      { handle: 't2', name: 'feature/x' }
    ])
    await hands.typeInto('t1', 'ls', true)
    expect(runtime.sendTerminal.mock.calls.map((call) => call[1])).toEqual([
      { text: 'ls' },
      { enter: true }
    ])
  })

  it('refuses to type into a terminal a phone is driving', async () => {
    const hands = createRuntimeQuickHands(() => fakeRuntime('mobile'), async () => undefined)
    await expect(hands.typeInto('t1', 'ls', false)).rejects.toThrow(/phone/)
  })
})
