import { describe, expect, it } from 'vitest'
import { BOARD_LOOP_TEMPLATES } from './board-loop-templates'
import { BOARD_TARGET_KEY, buildLoopTrigger } from './loop-form'
import { loopFormFromTemplate } from './loop-form-template'

describe('loopFormFromTemplate', () => {
  it('every template becomes a form that builds a valid trigger', () => {
    for (const template of BOARD_LOOP_TEMPLATES) {
      const form = loopFormFromTemplate(template, 'tab:t1')
      expect(form.name).toBe(template.title)
      expect(buildLoopTrigger(form).ok, template.id).toBe(true)
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
})
