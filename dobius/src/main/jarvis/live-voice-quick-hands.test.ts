import { describe, expect, it, vi } from 'vitest'
import {
  coreOfRequest,
  findTerminal,
  lastSpokenLine,
  looksSecret,
  matchQuickHand,
  QuickHandCancelled,
  QuickHandRefused,
  runQuickHand,
  type QuickHandsDeps,
  type QuickTerminal
} from './live-voice-quick-hands'
import { createRuntimeQuickHands, type QuickHandsRuntime } from './live-voice-quick-hands-runtime'

const TERMINALS: QuickTerminal[] = [
  { handle: 'h1', name: 'Backend' },
  { handle: 'h2', name: '✳ Fix login bug' },
  { handle: 'h3', name: 'docs site' },
  { handle: 'h4', name: 'API server' },
  { handle: 'h5', name: 'API tests' },
  { handle: 'h6', name: 'readme' }
]

type FakeDeps = QuickHandsDeps & { typeInto: ReturnType<typeof vi.fn> }

function fakeDeps(over: Partial<QuickHandsDeps> = {}): FakeDeps {
  return {
    listTerminals: async () => ({ terminals: TERMINALS, truncated: false }),
    typeInto: vi.fn(async () => undefined),
    readTail: async () => ['first', '\u001b[32m✔ built in 2.1s\u001b[0m', '   ', '\u001b[2K'],
    weekUsage: async () => ({ costUsd: 12.5, sessions: 40 }),
    ...over
  } as FakeDeps
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
    ['type ls into backend', 'ls', 'backend'],
    ['Type npm test in the API tests terminal', 'npm test', 'api tests'],
    ['type "git status" into backend', 'git status', 'backend'],
    ['Please type git pull into the docs site tab.', 'git pull', 'docs site'],
    ['type fix the bug in login into fix login bug', 'fix the bug in login', 'fix login bug']
  ])('matches %s', (phrase, text, target) => {
    expect(matchQuickHand(phrase)).toEqual({ hand: 'type', text, target })
  })

  it('keeps the typed text exactly as said: casing, inner spacing, quotes inside', () => {
    expect(matchQuickHand('type ls -A into Backend')).toMatchObject({ text: 'ls -A' })
    expect(matchQuickHand('Hey Adam, type  echo  "Hi"  into backend')).toMatchObject({
      text: 'echo  "Hi"'
    })
    expect(matchQuickHand('type "  spaced  " into backend')).toMatchObject({ text: '  spaced  ' })
  })

  it.each([
    'type ls into backend and press enter',
    'type ls into backend and hit enter',
    'type git push into backend, then send it',
    'type ls into backend and submit',
    'type rm -rf build into backend and run it'
  ])('never submits: %s goes to ADAM', (phrase) => {
    expect(matchQuickHand(phrase)).toBeNull()
  })

  it('refuses typed text with control characters', () => {
    expect(matchQuickHand('type ls\u0003 into backend')).toBeNull()
  })
})

describe('coreOfRequest', () => {
  it('strips the wake word, politeness and end punctuation but keeps the rest as said', () => {
    expect(coreOfRequest('Hey Adam, type  Foo  into X please!')).toBe('type  Foo  into X')
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
    ['how much have I spent on claude today', true],
    ['How much did I spend on AI?', false],
    ["what's my usage", false],
    ['what is my claude spend today', true],
    ['how much have we spent on claude this week', false],
    ['check my claude usage', false]
  ])('matches %s', (phrase, today) => {
    expect(matchQuickHand(phrase)).toEqual({ hand: 'usage', today })
  })

  it.each(['how much have I spent', 'how much did I spend today', "what's my spend"])(
    'leaves %s to ADAM: it does not say Claude, AI, tokens or usage',
    (phrase) => {
      expect(matchQuickHand(phrase)).toBeNull()
    }
  )
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
    const line = lastSpokenLine(['x '.repeat(200)])
    expect(line?.length).toBe(150)
    expect(line?.endsWith('…')).toBe(true)
  })
  it('is null with no output', () => {
    expect(lastSpokenLine(['', '   '])).toBeNull()
  })
})

// Synthetic, made-up values shaped like real credentials. None is a real key.
const FAKE_SECRETS = [
  'OPENAI_API_KEY=sk-FAKEfakeFAKEfake0000',
  'export KEY=sk-proj-FAKE_fake-0000',
  'session ek_FAKEfake00000000',
  'remote: ghp_FAKEfakeFAKE0000',
  'oauth gho_FAKEfakeFAKE0000',
  'pat github_pat_FAKE_fake0000',
  'slack xoxb-0000-FAKE-fake',
  'aws AKIAFAKEFAKEFAKE0000',
  'Authorization: Bearer FAKEfake.token.0000',
  'blob QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0MTIz',
  'hash 0123456789abcdef0123456789abcdef',
  'password: hunter2',
  'db passwd=x',
  'client secret = abc',
  'TOKEN: abc',
  'api key: abc',
  'API_KEY=abc'
]

describe('looksSecret', () => {
  it.each(FAKE_SECRETS)('flags %s', (line) => {
    expect(looksSecret(line)).toBe(true)
  })
  it.each(['✔ built in 2.1s', 'Tests  370 passed', 'git status: clean', 'the token budget is fine'])(
    'lets %s through',
    (line) => {
      expect(looksSecret(line)).toBe(false)
    }
  )
})

describe('runQuickHand', () => {
  it('counts terminals and names up to five', async () => {
    const result = await runQuickHand('how many terminals are open', fakeDeps())
    expect(result).toEqual({
      name: 'list-terminals',
      speak:
        '6 terminals are open: Backend, ✳ Fix login bug, docs site, API server, API tests, and 1 more.'
    })
  })

  it('types without Enter into the terminal with that exact name', async () => {
    const deps = fakeDeps()
    expect(await runQuickHand('type ls into backend', deps)).toEqual({
      name: 'type',
      speak: 'Typed it into Backend.'
    })
    expect(deps.typeInto).toHaveBeenCalledWith('h1', 'ls', expect.any(Function))
  })

  it('type needs the whole label: a partial name goes to ADAM', async () => {
    const deps = fakeDeps()
    expect(await runQuickHand('type ls into login bug', deps)).toBeNull()
    expect(await runQuickHand('type ls into frontend', deps)).toBeNull()
    expect(deps.typeInto).not.toHaveBeenCalled()
  })

  it('type refuses when the terminal list was cut off', async () => {
    const deps = fakeDeps({ listTerminals: async () => ({ terminals: TERMINALS, truncated: true }) })
    expect(await runQuickHand('type ls into backend', deps)).toBeNull()
    expect(deps.typeInto).not.toHaveBeenCalled()
  })

  it('a refusal before any write hands the request on (throws)', async () => {
    const deps = fakeDeps({
      typeInto: async () => {
        throw new QuickHandRefused('permission prompt')
      }
    })
    await expect(runQuickHand('type ls into backend', deps)).rejects.toThrow('permission prompt')
  })

  it('a failure after a write may have happened is spoken, never handed on', async () => {
    const deps = fakeDeps({
      typeInto: async () => {
        throw new Error('terminal_not_writable')
      }
    })
    expect(await runQuickHand('type ls into backend', deps)).toEqual({
      name: 'type',
      speak: 'I may have typed part of that into Backend; check it.'
    })
  })

  it('writes nothing and reports cancelled when the call ended during the listing', async () => {
    const deps = fakeDeps()
    expect(await runQuickHand('type ls into backend', deps, () => false)).toEqual({
      name: 'type',
      speak: '',
      cancelled: true
    })
    expect(deps.typeInto).not.toHaveBeenCalled()
    const ended = fakeDeps({
      typeInto: async () => {
        throw new QuickHandCancelled('the call ended')
      }
    })
    expect(await runQuickHand('type ls into backend', ended)).toMatchObject({ cancelled: true })
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

  it.each(FAKE_SECRETS)('never reads out a secret-shaped line: %s', async (line) => {
    const deps = fakeDeps({ readTail: async () => [line] })
    expect((await runQuickHand("what's backend doing", deps))?.speak).toBe(
      "Backend's last line looks like it has a secret, so I won't read it out."
    )
  })

  it('reports the week of usage and says when today is not tracked', async () => {
    expect((await runQuickHand('how much have I spent on claude today', fakeDeps()))?.speak).toBe(
      'About $12.50 on Claude over the last 7 days, across 40 sessions. There is no separate total for today.'
    )
    expect(await runQuickHand("what's my usage", fakeDeps({ weekUsage: async () => null }))).toBeNull()
  })
})

describe('createRuntimeQuickHands', () => {
  function fakeRuntime(
    driver = 'idle',
    agent: { isRunningAgent: boolean; status: string | null } = {
      isRunningAgent: true,
      status: 'idle'
    },
    truncated = false
  ): QuickHandsRuntime & {
    sendTerminal: ReturnType<typeof vi.fn>
    listTerminals: ReturnType<typeof vi.fn>
  } {
    return {
      listTerminals: vi.fn(async () => ({
        terminals: [
          { handle: 't1', title: 'Backend', branch: 'main' },
          { handle: 't2', title: null, branch: 'feature/x' }
        ] as never,
        truncated
      })),
      readTerminal: async (handle) => ({ handle, tail: ['ok'] }) as never,
      sendTerminal: vi.fn(async (_handle, _action, options) => {
        await options?.beforeWrite?.('pty-1')
      }),
      getDriver: () => ({ kind: driver }),
      getTerminalAgentStatus: async () => agent
    }
  }

  it('names terminals by title, else branch, asks for a large list, and reports truncation', async () => {
    const runtime = fakeRuntime('idle', undefined, true)
    const hands = createRuntimeQuickHands(() => runtime)
    expect(await hands.listTerminals()).toEqual({
      truncated: true,
      terminals: [
        { handle: 't1', name: 'Backend' },
        { handle: 't2', name: 'feature/x' }
      ]
    })
    expect(runtime.listTerminals).toHaveBeenCalledWith(undefined, 1_000)
  })

  it('sends only text, never Enter', async () => {
    const runtime = fakeRuntime()
    await createRuntimeQuickHands(() => runtime).typeInto('t1', 'ls', () => true)
    expect(runtime.sendTerminal.mock.calls.map((call) => call[1])).toEqual([{ text: 'ls' }])
  })

  it('may type into a plain shell (no Enter, so nothing runs)', async () => {
    const runtime = fakeRuntime('idle', { isRunningAgent: false, status: null })
    await createRuntimeQuickHands(() => runtime).typeInto('t1', 'hello', () => true)
    expect(runtime.sendTerminal).toHaveBeenCalledTimes(1)
  })

  it('refuses, before writing, a terminal a phone is driving', async () => {
    const hands = createRuntimeQuickHands(() => fakeRuntime('mobile'))
    await expect(hands.typeInto('t1', 'ls', () => true)).rejects.toBeInstanceOf(QuickHandRefused)
  })

  it('refuses, before writing, a terminal waiting on a permission prompt', async () => {
    const runtime = fakeRuntime('idle', { isRunningAgent: true, status: 'permission' })
    await expect(
      createRuntimeQuickHands(() => runtime).typeInto('t1', 'yes', () => true)
    ).rejects.toBeInstanceOf(QuickHandRefused)
  })

  it('writes nothing once the call ended', async () => {
    const runtime = fakeRuntime()
    await expect(
      createRuntimeQuickHands(() => runtime).typeInto('t1', 'ls', () => false)
    ).rejects.toBeInstanceOf(QuickHandCancelled)
  })

  it('a send error before any write is a refusal; one after a write is not', async () => {
    const early = fakeRuntime()
    early.sendTerminal.mockImplementation(async () => {
      throw new Error('terminal_not_writable')
    })
    await expect(
      createRuntimeQuickHands(() => early).typeInto('t1', 'ls', () => true)
    ).rejects.toBeInstanceOf(QuickHandRefused)

    const late = fakeRuntime()
    late.sendTerminal.mockImplementation(async (_handle, _action, options) => {
      await options?.beforeWrite?.('pty-1')
      throw new Error('terminal_not_writable')
    })
    const error = await createRuntimeQuickHands(() => late)
      .typeInto('t1', 'ls', () => true)
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(QuickHandRefused)
  })
})
