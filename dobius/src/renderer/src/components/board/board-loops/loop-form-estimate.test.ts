import { describe, expect, it } from 'vitest'
import { DEFAULT_LOOP_FORM } from './loop-form'
import {
  describePromptsPerHour,
  estimatePromptsPerHour,
  loopEstimateLine
} from './loop-form-estimate'

describe('estimatePromptsPerHour', () => {
  it('schedule: runs per hour times consoles', () => {
    const form = { ...DEFAULT_LOOP_FORM, kind: 'schedule' as const, everyMin: 15 }
    expect(estimatePromptsPerHour(form, 1)).toEqual({ perHour: 4, consoles: 1, upTo: false })
    expect(estimatePromptsPerHour(form, 3)).toEqual({ perHour: 12, consoles: 3, upTo: false })
    expect(describePromptsPerHour({ perHour: 4, consoles: 1, upTo: false })).toBe(
      '≈ 4.0 prompts/h across 1 console'
    )
  })

  it('goal and output-match are ceilings', () => {
    const goal = { ...DEFAULT_LOOP_FORM, kind: 'goal' as const, checkEverySec: 120, maxRuns: 50 }
    expect(estimatePromptsPerHour(goal, 2)).toEqual({ perHour: 60, consoles: 2, upTo: true })
    expect(estimatePromptsPerHour({ ...goal, maxRuns: 5 }, 2)?.perHour).toBe(10)
    const match = { ...DEFAULT_LOOP_FORM, kind: 'on-output-match' as const, cooldownSec: 60 }
    expect(estimatePromptsPerHour(match, 4)).toEqual({ perHour: 240, consoles: 4, upTo: true })
    expect(describePromptsPerHour({ perHour: 60, consoles: 2, upTo: true })).toBe(
      'up to ≈ 60.0 prompts/h across 2 consoles'
    )
  })

  it('no estimate for on-idle or an empty target', () => {
    expect(estimatePromptsPerHour({ ...DEFAULT_LOOP_FORM, kind: 'on-idle' }, 2)).toBeNull()
    expect(estimatePromptsPerHour({ ...DEFAULT_LOOP_FORM, kind: 'schedule' }, 0)).toBeNull()
  })
})

describe('loopEstimateLine (always visible)', () => {
  it('shows the rate for schedule, goal and output-match loops', () => {
    expect(loopEstimateLine({ ...DEFAULT_LOOP_FORM, kind: 'schedule', everyMin: 15 }, 1)).toBe(
      '≈ 4.0 prompts/h across 1 console'
    )
    expect(
      loopEstimateLine({ ...DEFAULT_LOOP_FORM, kind: 'goal', checkEverySec: 120, maxRuns: 50 }, 2)
    ).toBe('up to ≈ 60.0 prompts/h across 2 consoles')
    expect(
      loopEstimateLine({ ...DEFAULT_LOOP_FORM, kind: 'on-output-match', cooldownSec: 60 }, 3)
    ).toBe('up to ≈ 180.0 prompts/h across 3 consoles')
    expect(
      loopEstimateLine({ ...DEFAULT_LOOP_FORM, kind: 'on-output-match', cooldownSec: 60 }, 1)
    ).toBe('up to ≈ 60.0 prompts/h to 1 console')
  })

  it('explains on-idle instead of showing nothing (the default trigger)', () => {
    expect(loopEstimateLine({ ...DEFAULT_LOOP_FORM, kind: 'on-idle' }, 2)).toContain(
      'each time one of 2 consoles goes idle'
    )
  })

  it('says why nothing will be sent when no console matches', () => {
    expect(loopEstimateLine({ ...DEFAULT_LOOP_FORM, kind: 'schedule' }, 0)).toContain(
      'No consoles match'
    )
  })
})
