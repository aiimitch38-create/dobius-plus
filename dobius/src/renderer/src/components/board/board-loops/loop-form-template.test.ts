import { describe, expect, it } from 'vitest'
import { BOARD_LOOP_TEMPLATES } from './board-loop-templates'
import { BOARD_TARGET_KEY, buildLoopTrigger, loopStopFields } from './loop-form'
import { loopFormFromTemplate } from './loop-form-template'

describe('loopFormFromTemplate', () => {
  it('every template becomes a form that builds a valid trigger', () => {
    for (const template of BOARD_LOOP_TEMPLATES) {
      const form = loopFormFromTemplate(template, 'tab:t1')
      expect(form.name).toBe(template.title)
      expect(buildLoopTrigger(form).ok, template.id).toBe(true)
      expect(loopStopFields(form).ok, template.id).toBe(true)
    }
  })

  it('maps every-console schedules to the board target and keeps the time limit', () => {
    const schedule = BOARD_LOOP_TEMPLATES.find(
      (t) => t.trigger.kind === 'schedule' && t.target === 'every-console'
    )!
    const form = loopFormFromTemplate(schedule, 'tab:t1')
    expect(form).toMatchObject({ kind: 'schedule', targetKey: BOARD_TARGET_KEY })
    expect(form.stopAfterMin).toBe(schedule.stop.timeLimitMinutes ?? 0)
  })

  it('points output-match templates at one console', () => {
    const match = BOARD_LOOP_TEMPLATES.find((t) => t.trigger.kind === 'on-output-match')!
    expect(loopFormFromTemplate(match, 'tab:t9').targetKey).toBe('tab:t9')
  })

  it('carries the until-command-passes and run-count stops into the saved loop', () => {
    const rescue = BOARD_LOOP_TEMPLATES.find((t) => t.id === 'build-rescue')!
    const nudge = BOARD_LOOP_TEMPLATES.find((t) => t.id === 'idle-nudge')!
    expect(loopStopFields(loopFormFromTemplate(rescue, 'tab:t1'))).toEqual({
      ok: true,
      fields: { stopCommand: 'pnpm run build' }
    })
    expect(loopStopFields(loopFormFromTemplate(nudge, 'tab:t1'))).toEqual({
      ok: true,
      fields: { stopAfterRuns: 10 }
    })
  })
})
