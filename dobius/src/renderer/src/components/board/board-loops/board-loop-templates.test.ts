import { describe, expect, it } from 'vitest'
import { BOARD_LOOP_TEMPLATES, getLoopTemplate } from './board-loop-templates'

describe('board loop templates', () => {
  it('contains exactly seven templates for the studio grid', () => {
    expect(BOARD_LOOP_TEMPLATES).toHaveLength(7)
  })

  it('has unique template ids', () => {
    expect(new Set(BOARD_LOOP_TEMPLATES.map((t) => t.id)).size).toBe(BOARD_LOOP_TEMPLATES.length)
  })

  it('compiles every on-output-match pattern and keeps them linear', () => {
    for (const template of BOARD_LOOP_TEMPLATES) {
      if (template.trigger.kind !== 'on-output-match') {
        continue
      }
      const { pattern } = template.trigger
      expect(() => new RegExp(pattern)).not.toThrow()
      expect(pattern).toMatch(/^(?:[^\\()]|\\[dbswDSW+*{}.,:[\]^$|()\\-])*$/)
      expect(pattern).not.toMatch(/\([^)]*[+*]\)[+*]/)
      expect(pattern.length).toBeLessThan(120)
    }
  })

  it('uses a positive interval for every schedule trigger', () => {
    for (const template of BOARD_LOOP_TEMPLATES) {
      if (template.trigger.kind !== 'schedule') {
        continue
      }
      expect(template.trigger.everyMinutes).toBeGreaterThan(0)
    }
  })

  it('attaches a stop condition to every schedule template', () => {
    for (const template of BOARD_LOOP_TEMPLATES) {
      if (template.trigger.kind !== 'schedule') {
        continue
      }
      const hasStop =
        template.stop.maxRuns !== undefined ||
        template.stop.timeLimitMinutes !== undefined ||
        template.stop.untilCommandPasses !== undefined
      expect(hasStop).toBe(true)
    }
  })

  it('gives non-schedule triggers sane throttling values', () => {
    for (const template of BOARD_LOOP_TEMPLATES) {
      if (template.trigger.kind === 'on-idle') {
        expect(template.trigger.debounceMs).toBeGreaterThan(0)
      }
      if (template.trigger.kind === 'on-output-match') {
        expect(template.trigger.cooldownMs).toBeGreaterThan(0)
      }
    }
  })

  it('looks templates up by id and returns undefined when missing', () => {
    expect(getLoopTemplate('build-rescue')?.title).toBe('Build rescue')
    expect(getLoopTemplate('no-such-loop')).toBeUndefined()
  })
})
