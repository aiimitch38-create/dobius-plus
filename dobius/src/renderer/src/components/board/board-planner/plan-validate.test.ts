import { describe, expect, it } from 'vitest'
import { BOARD } from './plan-fixtures.test-support'
import { extractPlanJson, validatePlan } from './plan-validate'

const plan = (steps: unknown[], say = 'Done that.') => ({ intent: 'x', steps, say })
const reason = (raw: unknown): string => {
  const v = validatePlan(raw, BOARD)
  return v.ok ? 'ok' : v.reason
}

describe('extractPlanJson', () => {
  it('pulls the object out of fenced or chatty replies', () => {
    expect(extractPlanJson('Here:\n```json\n{"steps":[]}\n```')).toEqual({ steps: [] })
    expect(extractPlanJson('no json')).toBeNull()
  })
})

describe('validatePlan', () => {
  it('accepts a well-formed plan', () => {
    const v = validatePlan(
      plan(
        [
          {
            kind: 'tell',
            target: 'Codex 1',
            text: 'Run the unit tests and report failures with file:line.'
          }
        ],
        'Asked Codex 1.'
      ),
      BOARD
    )
    expect(v.ok && v.plan.steps[0]).toMatchObject({ kind: 'tell', target: 'Codex 1' })
  })

  it.each([
    [[{ kind: 'explode' }], 'unknown step kind'],
    [[{ kind: 'tell', target: 'Ghost', text: 'hi' }], 'not on the board'],
    [[{ kind: 'tell', target: 'Codex 1' }], 'tell needs text'],
    [[{ kind: 'relay' }], 'relay needs text'],
    [[{ kind: 'spawn', count: 2 }], 'spawn needs a brief'],
    [[{ kind: 'spawn', brief: 'b', count: 40 }], 'count must be 1-12'],
    [[{ kind: 'open_studio', target: 'casino' }], 'unknown studio'],
    [[{ kind: 'pick_tool', target: 'laser' }], 'unknown tool'],
    [[{ kind: 'set_theme', target: 'neon' }], 'unknown theme'],
    [[{ kind: 'git', target: 'rebase' }], 'unknown git action'],
    [[{ kind: 'insert_markdown', path: 'SECRET.md' }], 'is not listed'],
    [[{ kind: 'deploy_preset', target: 'Nope' }], 'not in the library'],
    [[{ kind: 'loop', text: 'check', interval_minutes: 0 }], 'interval_minutes'],
    [[{ kind: 'kill_group', target: 'Codex 1' }], 'is not a group'],
    [Array.from({ length: 9 }, () => ({ kind: 'zoom_in' })), 'more than 8 steps']
  ])('rejects %j', (steps, expected) => {
    expect(reason(plan(steps))).toContain(expected)
  })

  it('rejects closing the only workspace', () => {
    expect(
      validatePlan(plan([{ kind: 'close_workspace', target: 'main' }]), {
        ...BOARD,
        workspaces: [{ name: 'main', current: true }]
      })
    ).toMatchObject({ ok: false })
  })

  it('rejects one long task sent whole to a group, but allows short directives', () => {
    expect(
      reason(
        plan([
          {
            kind: 'tell',
            target: 'Team A',
            text: 'Review the whole checkout flow for bugs and report file:line findings.'
          }
        ])
      )
    ).toContain('split the task')
    expect(
      reason(
        plan([{ kind: 'tell', target: 'Team A', text: 'Commit your work now.' }], 'Told Team A.')
      )
    ).toBe('ok')
  })

  it('rejects duplicate long tells and "split among yourselves"', () => {
    const t = 'Review the checkout flow for bugs and report findings with file:line.'
    expect(
      reason(
        plan([
          { kind: 'tell', target: 'Claude 1', text: t },
          { kind: 'tell', target: 'Codex 1', text: t }
        ])
      )
    ).toContain('different slice')
    expect(reason(plan([{ kind: 'relay', text: 'Split the work among yourselves.' }]))).toContain(
      'among themselves'
    )
  })

  it('rejects questions for the user inside agent text and ask-and-act replies', () => {
    expect(reason(plan([{ kind: 'relay', text: 'Do you want me to refactor this?' }]))).toContain(
      'question for the user'
    )
    expect(
      reason(plan([{ kind: 'tell', target: 'Codex 1', text: 'Run lint.' }], 'Which file?'))
    ).toContain('ask or act')
    expect(reason(plan([{ kind: 'zoom_in' }], 'Should I zoom in?'))).toContain('asks permission')
  })

  it('rejects claiming an action with no steps', () => {
    expect(reason(plan([], 'I opened the docs.'))).toContain('no steps')
    expect(reason(plan([], 'Which console do you mean?'))).toBe('ok')
  })

  it('rejects several orchestrators with no name', () => {
    const board = {
      ...BOARD,
      orchestrators: [
        { name: 'A', wired: [] },
        { name: 'B', wired: [] }
      ]
    }
    expect(
      validatePlan(plan([{ kind: 'connect_orchestrator', target: 'Codex 1' }]), board)
    ).toMatchObject({ ok: false })
  })
})

describe('validatePlan loop steps', () => {
  it('keeps the loop target and stop command, and rejects names not on the board', () => {
    const v = validatePlan(
      plan([
        {
          kind: 'loop',
          text: 'run the tests',
          interval_minutes: 10,
          target: 'Team A',
          stop_command: 'pnpm test'
        }
      ]),
      BOARD
    )
    expect(v.ok && v.plan.steps[0]).toEqual({
      kind: 'loop',
      text: 'run the tests',
      intervalMinutes: 10,
      target: 'Team A',
      stopCommand: 'pnpm test'
    })
    expect(
      reason(plan([{ kind: 'loop', text: 'x', interval_minutes: 5, target: 'Ghost' }]))
    ).toContain('not on the board')
  })
})

describe('validatePlan loop addressee', () => {
  it('moves a named console out of the loop text into the target', () => {
    const v = validatePlan(
      plan([{ kind: 'loop', text: 'tell Claude 1 to run the tests', interval_minutes: 10 }]),
      BOARD
    )
    expect(v.ok && v.plan.steps[0]).toMatchObject({
      kind: 'loop',
      text: 'run the tests',
      target: 'Claude 1'
    })
  })

  it('refuses instead of widening to every console when the named console is unknown', () => {
    expect(
      reason(plan([{ kind: 'loop', text: 'tell Ghost 9 to run the tests', interval_minutes: 10 }]))
    ).toContain('"Ghost 9", which is not on the board')
  })
})
