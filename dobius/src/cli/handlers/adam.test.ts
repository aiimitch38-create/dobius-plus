import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import {
  isCommandGroup,
  normalizeCommandPositionals,
  parseArgs,
  validateCommandAndFlags
} from '../args'
import { COMMAND_SPECS } from '../specs'
import { ADAM_HANDLERS, formatAdamStatus, formatAskResult, isInsideAdamHermes } from './adam'

let logged: string[] = []

beforeEach(() => {
  logged = []
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line)
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

async function run(argv: string[], result: unknown = {}, json = false) {
  const parsed = normalizeCommandPositionals(COMMAND_SPECS, parseArgs(argv))
  validateCommandAndFlags(COMMAND_SPECS, parsed)
  const handler = ADAM_HANDLERS[parsed.commandPath.join(' ')]
  expect(handler, `no handler for ${parsed.commandPath.join(' ')}`).toBeDefined()
  const call = vi.fn(async () => ({ id: 'r', ok: true, result }))
  await handler({
    flags: parsed.flags,
    client: { call },
    cwd: '/',
    json
  } as unknown as HandlerContext)
  return call
}

describe('adam CLI', () => {
  it('has a handler for every adam spec', () => {
    const specs = COMMAND_SPECS.filter((spec) => spec.path[0] === 'adam')
    expect(specs.map((spec) => spec.path.join(' ')).sort()).toEqual(
      Object.keys(ADAM_HANDLERS).sort()
    )
    expect(isCommandGroup(['adam'])).toBe(true)
  })

  it('ask sends text and source, and waits with a long timeout only with --wait', async () => {
    vi.stubEnv('HERMES_HOME', '')
    let call = await run(['adam', 'ask', '--text', 'hi', '--source', 'codex'], {
      sent: true,
      waited: false
    })
    expect(call).toHaveBeenCalledWith('adam.ask', { text: 'hi', source: 'codex' }, undefined)
    expect(logged.at(-1)).toContain('Sent to ADAM')

    call = await run(['adam', 'ask', '--text', 'hi', '--wait'], {
      sent: true,
      waited: true,
      reply: { kind: 'answer', text: 'Hello Carson.' }
    })
    expect(call).toHaveBeenCalledWith(
      'adam.ask',
      { text: 'hi', wait: true },
      { timeoutMs: 240_000 }
    )
    expect(logged.at(-1)).toBe('Hello Carson.')
    call = await run(['adam', 'ask', '--text', 'hi', '--wait=true'], { sent: true, waited: true })
    expect(call).toHaveBeenCalledWith(
      'adam.ask',
      { text: 'hi', wait: true },
      { timeoutMs: 240_000 }
    )
    call = await run(['adam', 'ask', '--text', 'hi', '--wait=false'], { sent: true, waited: false })
    expect(call).toHaveBeenCalledWith('adam.ask', { text: 'hi' }, undefined)
    await expect(run(['adam', 'ask', '--text', 'hi', '--wait=maybe'])).rejects.toThrow(
      /true or false/
    )
  })

  it('refuses inside ADAM’s own Hermes process without calling the app', async () => {
    vi.stubEnv('HERMES_HOME', '/Users/x/.hermes/profiles/adam')
    await expect(run(['adam', 'ask', '--text', 'hi'])).rejects.toThrow(/ADAM’s own Hermes/)
    expect(isInsideAdamHermes({ HERMES_HOME: '/Users/x/.hermes/profiles/adam/' })).toBe(true)
    expect(isInsideAdamHermes({ HERMES_HOME: '/Users/x/.hermes/profiles/worker' })).toBe(false)
    expect(isInsideAdamHermes({})).toBe(false)
  })

  it('mode takes on/off positionally and refuses anything else', async () => {
    const call = await run(['adam', 'mode', 'on'], { active: true, ok: true })
    expect(call).toHaveBeenCalledWith('adam.setMode', { active: true })
    expect(logged.at(-1)).toBe('Voice mode is on.')
    await expect(run(['adam', 'mode', 'maybe'])).rejects.toThrow(/on or off/)
  })

  it('say and status call their methods; --json prints the raw envelope', async () => {
    let call = await run(['adam', 'say', '--text', 'Done'], { played: true })
    expect(call).toHaveBeenCalledWith('adam.say', { text: 'Done' }, { timeoutMs: 240_000 })
    call = await run(['adam', 'status', '--json'], { busy: true, voiceReady: false }, true)
    expect(call).toHaveBeenCalledWith('adam.status')
    expect(JSON.parse(logged.at(-1) ?? '')).toMatchObject({ result: { busy: true } })
  })

  it('formats replies and status in plain words', () => {
    expect(formatAskResult({ sent: true, waited: true, reply: { kind: 'error', text: '' } })).toBe(
      'ADAM could not answer. He sent back an empty reply.'
    )
    expect(formatAdamStatus({ busy: false, voiceReady: true, shortcutActive: false })).toBe(
      'ADAM is free.\nVoice mode is off.'
    )
  })
})

describe('adam notify CLI', () => {
  it('is refused outside ADAM’s own Hermes session', async () => {
    vi.stubEnv('HERMES_HOME', '/Users/c/.hermes/profiles/adam')
    vi.stubEnv('DOBIUS_CALLER', 'adam')
    vi.stubEnv('DOBIUS_ADAM_CALLER_ID', '')
    await expect(run(['adam', 'notify', '--text', 'hi'])).rejects.toThrow(/Only ADAM/)
    vi.stubEnv('DOBIUS_ADAM_CALLER_ID', 'id-1')
    vi.stubEnv('HERMES_HOME', '/Users/c/.hermes/profiles/other')
    await expect(run(['adam', 'notify', '--text', 'hi'])).rejects.toThrow(/Only ADAM/)
  })

  it('sends the text, --urgent and the caller id for ADAM', async () => {
    vi.stubEnv('HERMES_HOME', '/Users/c/.hermes/profiles/adam')
    vi.stubEnv('DOBIUS_CALLER', 'adam')
    vi.stubEnv('DOBIUS_ADAM_CALLER_ID', 'id-1')
    const call = await run(['adam', 'notify', '--text', 'PR waits', '--urgent'], {
      delivered: 'spoken',
      savedInThread: true
    })
    expect(call).toHaveBeenCalledWith('adam.notify', {
      text: 'PR waits',
      urgent: true,
      caller: 'adam',
      callerId: 'id-1'
    })
    expect(logged.join('\n')).toContain('Carson will hear it on the live call')
  })
})

describe('adam draft-text CLI', () => {
  it('is refused outside ADAM’s own Hermes session', async () => {
    vi.stubEnv('HERMES_HOME', '/Users/c/.hermes/profiles/adam')
    vi.stubEnv('DOBIUS_CALLER', 'adam')
    vi.stubEnv('DOBIUS_ADAM_CALLER_ID', '')
    await expect(run(['adam', 'draft-text', '--to', 'Brett', '--text', 'hi'])).rejects.toThrow(
      /Only ADAM can use dobius adam draft-text/
    )
    vi.stubEnv('DOBIUS_ADAM_CALLER_ID', 'id-1')
    vi.stubEnv('DOBIUS_CALLER', '')
    await expect(run(['adam', 'draft-text', '--to', 'Brett', '--text', 'hi'])).rejects.toThrow(
      /Only ADAM/
    )
  })

  it('sends recipient, text and caller id, and says nothing was sent', async () => {
    vi.stubEnv('HERMES_HOME', '/Users/c/.hermes/profiles/adam')
    vi.stubEnv('DOBIUS_CALLER', 'adam')
    vi.stubEnv('DOBIUS_ADAM_CALLER_ID', 'id-1')
    const call = await run(['adam', 'draft-text', '--to', 'Brett', '--text', 'At 3?'], {
      draftId: 'draft-1',
      toName: 'Brett',
      toHandle: '+15550102000',
      sent: false
    })
    expect(call).toHaveBeenCalledWith('adam.draftText', {
      to: 'Brett',
      text: 'At 3?',
      caller: 'adam',
      callerId: 'id-1'
    })
    expect(logged.join('\n')).toContain('Not sent: Carson reviews it and clicks Send')
  })
})
