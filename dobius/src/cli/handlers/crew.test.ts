import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import { isCommandGroup, normalizeCommandPositionals, parseArgs, validateCommandAndFlags } from '../args'
import { COMMAND_SPECS } from '../specs'
import { CREW_HANDLERS, formatCrewState, formatDecisions, formatDrafts } from './crew'

let logged: string[] = []

beforeEach(() => {
  logged = []
  vi.restoreAllMocks()
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line)
  })
})

// Parses argv the same way cli/index.ts does, then runs the handler with a fake client.
async function run(argv: string[], result: unknown = {}, json = false) {
  const parsed = normalizeCommandPositionals(COMMAND_SPECS, parseArgs(argv))
  validateCommandAndFlags(COMMAND_SPECS, parsed)
  const handler = CREW_HANDLERS[parsed.commandPath.join(' ')]
  expect(handler, `no handler for ${parsed.commandPath.join(' ')}`).toBeDefined()
  const call = vi.fn(async () => ({ id: 'r', ok: true, result }))
  await handler({ flags: parsed.flags, client: { call }, cwd: '/', json } as unknown as HandlerContext)
  return call
}

describe('crew CLI', () => {
  it('has a handler for every crew spec and no yield command', () => {
    const crewSpecs = COMMAND_SPECS.filter((spec) => spec.path[0] === 'crew')
    expect(crewSpecs.map((spec) => spec.path.join(' ')).sort()).toEqual(
      Object.keys(CREW_HANDLERS).sort()
    )
    expect(Object.keys(CREW_HANDLERS)).not.toContain('crew yield')
    expect(isCommandGroup(['crew'])).toBe(true)
  })

  it('status, pause and resume call the gate methods', async () => {
    let call = await run(['crew', 'status'], { paused: false, status: 'ok', detail: null, filePath: '/f' })
    expect(call).toHaveBeenCalledWith('crew.state')
    expect(logged).toEqual(['Crew is running.'])

    call = await run(['crew', 'pause'], { paused: true })
    expect(call).toHaveBeenCalledWith('crew.setPaused', { paused: true })

    call = await run(['crew', 'resume'], { paused: false })
    expect(call).toHaveBeenCalledWith('crew.setPaused', { paused: false })
    expect(logged.at(-1)).toBe('Crew resumed.')
  })

  it('prints raw JSON with --json', async () => {
    await run(['crew', 'status', '--json'], { paused: true, status: 'ok', detail: null, filePath: '/f' }, true)
    expect(JSON.parse(logged[0])).toMatchObject({ result: { paused: true } })
  })

  it('decide takes the id positionally and maps choice and note', async () => {
    let call = await run(['crew', 'decide', 'd1', '--choice', 'approve'], { id: 'd1', choice: 'approve' })
    expect(call).toHaveBeenCalledWith('crew.decide', { id: 'd1', choice: 'approve' })

    call = await run(['crew', 'decide', 'd1', '--choice', 'respond', '--note', 'use staging'], {
      id: 'd1',
      choice: 'respond'
    })
    expect(call).toHaveBeenCalledWith('crew.decide', {
      id: 'd1',
      choice: 'respond',
      note: 'use staging'
    })
  })

  it.each([
    ['an unknown choice', ['crew', 'decide', 'd1', '--choice', 'bypassRun']],
    ['respond with no note', ['crew', 'decide', 'd1', '--choice', 'respond']],
    ['a note on approve', ['crew', 'decide', 'd1', '--choice', 'approve', '--note', 'x']],
    ['a missing choice', ['crew', 'decide', 'd1']]
  ])('decide refuses %s before calling the app', async (_label, argv) => {
    await expect(run(argv)).rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('draft approve / discard and stop take their id positionally', async () => {
    const draft = { id: 'dr1', status: 'approved', target: { kind: 'asana', gid: '1' } }
    let call = await run(['crew', 'draft', 'approve', 'dr1'], { draft })
    expect(call).toHaveBeenCalledWith('crew.draftApprove', { id: 'dr1' })
    expect(logged.at(-1)).toBe('Draft dr1 posted to Asana.')

    call = await run(['crew', 'draft', 'discard', 'dr1'], { draft: { ...draft, status: 'discarded' } })
    expect(call).toHaveBeenCalledWith('crew.draftDiscard', { id: 'dr1' })

    call = await run(['crew', 'stop', 'r1'], { runId: 'r1', wasRunning: false })
    expect(call).toHaveBeenCalledWith('crew.stop', { runId: 'r1' })
    expect(logged.at(-1)).toBe('Run r1 was not running; nothing to stop.')
  })

  it('briefing and briefing dismiss are separate commands', async () => {
    let call = await run(['crew', 'briefing'], { items: [] })
    expect(call).toHaveBeenCalledWith('crew.briefing')
    expect(logged.at(-1)).toBe('The briefing is empty.')

    call = await run(['crew', 'briefing', 'dismiss'], { dismissed: true })
    expect(call).toHaveBeenCalledWith('crew.briefingDismiss')
  })

  it('rejects an unknown flag', () => {
    const parsed = normalizeCommandPositionals(COMMAND_SPECS, parseArgs(['crew', 'pause', '--reason', 'x']))
    expect(() => validateCommandAndFlags(COMMAND_SPECS, parsed)).toThrow()
  })
})

describe('crew formatters', () => {
  it('explains an unreadable control file', () => {
    expect(
      formatCrewState({ paused: true, status: 'unreadable', detail: 'EACCES', filePath: '/f.json' })
    ).toContain('could not be read (/f.json: EACCES)')
  })

  it('lists decisions and drafts on one line each', () => {
    expect(
      formatDecisions({
        decisions: [
          { id: 'd1', runId: 'r', agentId: 'a1', toolName: 'Bash', input: {}, title: 'Run\nnpm test', cwd: '/', createdAt: 0 }
        ]
      })
    ).toBe('d1  a1  Bash  Run npm test')
    expect(
      formatDrafts({
        drafts: [
          { id: 'dr1', agentId: 'a1', target: { kind: 'asana', gid: '42' }, body: 'Done.', createdAt: 0, status: 'pending' }
        ]
      })
    ).toBe('dr1  pending  asana:42  a1  Done.')
  })
})
