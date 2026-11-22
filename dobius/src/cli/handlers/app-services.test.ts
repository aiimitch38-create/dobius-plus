import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import {
  isCommandGroup,
  normalizeCommandPositionals,
  parseArgs,
  validateCommandAndFlags
} from '../args'
import { COMMAND_SPECS } from '../specs'
import { APP_SERVICE_HANDLERS, formatLimits, formatUpdate } from './app-services'

let logged: string[] = []

beforeEach(() => {
  logged = []
  vi.restoreAllMocks()
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line)
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

async function run(argv: string[], result: unknown = {}, json = false) {
  const parsed = normalizeCommandPositionals(COMMAND_SPECS, parseArgs(argv))
  validateCommandAndFlags(COMMAND_SPECS, parsed)
  const handler = APP_SERVICE_HANDLERS[parsed.commandPath.join(' ')]
  expect(handler, `no handler for ${parsed.commandPath.join(' ')}`).toBeDefined()
  const call = vi.fn(async () => ({ id: 'r', ok: true, result }))
  await handler({ flags: parsed.flags, client: { call }, cwd: '/', json } as unknown as HandlerContext)
  return call
}

const SUMMARY = {
  provider: 'claude',
  scan: { enabled: true, lastScanError: null },
  summary: {
    range: '7d',
    scope: 'all',
    sessions: 3,
    turns: 40,
    inputTokens: 1000,
    outputTokens: 2000,
    cacheReadTokens: 5,
    estimatedCostUsd: 1.5,
    topModel: 'opus',
    topProject: null
  }
}

describe('app service CLI', () => {
  it('registers every command and its groups', () => {
    for (const key of Object.keys(APP_SERVICE_HANDLERS)) {
      expect(COMMAND_SPECS.some((spec) => spec.path.join(' ') === key)).toBe(true)
    }
    for (const group of ['knowledge', 'imessage', 'update', 'backup']) {
      expect(isCommandGroup([group])).toBe(true)
    }
  })

  it('usage passes only the flags given and checks their values', async () => {
    let call = await run(['usage'], SUMMARY)
    expect(call).toHaveBeenCalledWith('usage.summary', {})
    expect(logged.at(-1)).toContain('About $1.50')
    call = await run(['usage', '--provider', 'codex', '--range', '30d'], SUMMARY)
    expect(call).toHaveBeenCalledWith('usage.summary', { provider: 'codex', range: '30d' })
    await expect(run(['usage', '--range', '1y'])).rejects.toThrow(/--range must be/)
  })

  it('limits refreshes only with --refresh', async () => {
    let call = await run(['limits', '--json'], { claude: null }, true)
    expect(call).toHaveBeenCalledWith('usage.rateLimits', {})
    call = await run(['limits', '--refresh'], { claude: null })
    expect(call).toHaveBeenCalledWith('usage.rateLimits', { refresh: true })
  })

  it('knowledge read takes the path positionally', async () => {
    const call = await run(['knowledge', 'read', '/a/b.md'], { content: '# hi', filePath: '/a/b.md' })
    expect(call).toHaveBeenCalledWith('knowledge.read', { path: '/a/b.md' })
    expect(logged.at(-1)).toBe('# hi')
  })

  it('status commands call read-only methods', async () => {
    expect(await run(['version'], { version: '2.1.9' })).toHaveBeenCalledWith('app.version')
    expect(
      await run(['update', 'status'], { version: '2.1.9', update: { state: 'idle' } })
    ).toHaveBeenCalledWith('app.updateStatus')
    expect(
      await run(['backup', 'status'], { health: 'healthy', detail: '', configured: false })
    ).toHaveBeenCalledWith('backup.status')
  })

  it('backup run and feedback call the gated methods', async () => {
    expect(
      await run(['backup', 'run'], { health: 'running', detail: '', configured: false })
    ).toHaveBeenCalledWith('backup.run')
    expect(await run(['feedback', '--text', 'hi'], { sent: true })).toHaveBeenCalledWith(
      'feedback.submit',
      { text: 'hi' }
    )
  })

  it('formats limits and update status in plain words', () => {
    expect(
      formatLimits({
        claude: {
          status: 'ok',
          session: { usedPercent: 42.4, windowMinutes: 300, resetsAt: null, resetDescription: '3 PM' },
          weekly: null
        }
      } as never)
    ).toBe('Claude\n    5 hours: 42% used, resets 3 PM')
    expect(formatUpdate({ version: '1', update: { state: 'available', version: '2', changelog: null } })).toContain(
      'Version 2 is available'
    )
  })
})
