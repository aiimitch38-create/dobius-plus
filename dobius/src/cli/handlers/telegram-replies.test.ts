import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import { normalizeCommandPositionals, parseArgs, validateCommandAndFlags } from '../args'
import { COMMAND_SPECS } from '../specs'
import { TELEGRAM_HANDLERS } from './telegram'

let logged: string[] = []
beforeEach(() => {
  logged = []
  vi.restoreAllMocks()
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line)
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

const SNAPSHOT = {
  phase: 'connected',
  connected: true,
  paused: false,
  lastError: null,
  groups: [{ id: '-1', title: 'NLD' }],
  drafts: [],
  replyHandling: { bridge: 'ready', listening: true },
  manualReviewCount: 0
}

async function run(argv: string[]) {
  const parsed = normalizeCommandPositionals(COMMAND_SPECS, parseArgs(argv))
  validateCommandAndFlags(COMMAND_SPECS, parsed)
  const handler = TELEGRAM_HANDLERS[parsed.commandPath.join(' ')]
  expect(handler).toBeDefined()
  const call = vi.fn(async () => ({ id: 'r', ok: true, result: { action: 'x', ...SNAPSHOT } }))
  await handler({ flags: parsed.flags, client: { call }, cwd: '/', json: false } as unknown as HandlerContext)
  return call
}

describe('telegram replies and snapshot CLI', () => {
  it('maps each replies verb to telegram.replies', async () => {
    for (const action of ['start', 'stop', 'pause', 'resume']) {
      const call = await run(['telegram', 'replies', action])
      expect(call).toHaveBeenCalledWith('telegram.replies', { action })
    }
    expect(logged.at(-1)).toContain('Telegram account reconnected.')
  })

  it('snapshot prints the account in plain words', async () => {
    const call = await run(['telegram', 'snapshot'])
    expect(call).toHaveBeenCalledWith('telegram.snapshot')
    expect(logged.at(-1)).toContain('Auto-replies: on (bridge ready)')
  })
})
