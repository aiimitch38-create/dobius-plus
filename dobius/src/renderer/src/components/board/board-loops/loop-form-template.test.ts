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

  it('watches every console for output-match templates and nudges one console when idle', () => {
    const rescue = BOARD_LOOP_TEMPLATES.find((t) => t.id === 'build-rescue')!
    expect(loopFormFromTemplate(rescue, 'tab:t9')).toMatchObject({
      kind: 'on-output-match',
      targetKey: BOARD_TARGET_KEY,
      pattern: 'FAILED'
    })
    const moving = BOARD_LOOP_TEMPLATES.find((t) => t.id === 'keep-moving')!
    expect(loopFormFromTemplate(moving, 'tab:t9')).toMatchObject({
      kind: 'on-idle',
      targetKey: 'tab:t9'
    })
  })

  it('carries the run-count stop into the saved loop and leaves rescue without a stop', () => {
    const rescue = BOARD_LOOP_TEMPLATES.find((t) => t.id === 'build-rescue')!
    const moving = BOARD_LOOP_TEMPLATES.find((t) => t.id === 'keep-moving')!
    expect(loopStopFields(loopFormFromTemplate(rescue, 'tab:t1'))).toEqual({
      ok: true,
      fields: {}
    })
    expect(loopStopFields(loopFormFromTemplate(moving, 'tab:t1'))).toEqual({
      ok: true,
      fields: { stopAfterRuns: 20 }
    })
  })

  it('matches the reference templates: ids, intervals and the FAILED watch', () => {
    const byId = Object.fromEntries(BOARD_LOOP_TEMPLATES.map((t) => [t.id, t]))
    expect(Object.keys(byId)).toEqual([
      'progress-check',
      'keep-moving',
      'build-rescue',
      'test-watchdog',
      'commit-checkpoint',
      'review-sweep',
      'hourly-standup'
    ])
    expect(byId['progress-check'].trigger).toEqual({ kind: 'schedule', everyMinutes: 15 })
    expect(byId['test-watchdog'].trigger).toEqual({ kind: 'schedule', everyMinutes: 30 })
    expect(byId['commit-checkpoint'].trigger).toEqual({ kind: 'schedule', everyMinutes: 20 })
    expect(byId['review-sweep'].trigger).toEqual({ kind: 'schedule', everyMinutes: 30 })
    expect(byId['hourly-standup'].trigger).toEqual({ kind: 'schedule', everyMinutes: 60 })
    expect(byId['keep-moving'].trigger.kind).toBe('on-idle')
    expect(byId['build-rescue'].trigger).toMatchObject({
      kind: 'on-output-match',
      pattern: 'FAILED'
    })
    expect(byId['progress-check'].instruction).toBe(
      'Give a one-line status update: what you just finished, what you are doing next, and anything blocking you.'
    )
  })
})
