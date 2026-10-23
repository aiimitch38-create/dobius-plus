import { describe, expect, it } from 'vitest'
import { getDefaultOnboardingState } from '../../../shared/constants'
import type { OnboardingState } from '../../../shared/types'
import { shouldSuppressContextualTours } from './useOnboardingAndFeatureTipsGate'

const completedOnboarding: OnboardingState = {
  ...getDefaultOnboardingState(),
  closedAt: Date.parse('2026-05-17T00:00:00.000Z'),
  outcome: 'completed',
  lastCompletedStep: 4
}

describe('shouldSuppressContextualTours', () => {
  it('suppresses tours before the persisted onboarding state has loaded', () => {
    expect(
      shouldSuppressContextualTours({
        activeView: 'terminal',
        onboarding: null,
        onboardingLoaded: false
      })
    ).toBe(true)
  })

  it('allows tours once onboarding is loaded, completed, and Classic is active', () => {
    expect(
      shouldSuppressContextualTours({
        activeView: 'terminal',
        onboarding: completedOnboarding,
        onboardingLoaded: true
      })
    ).toBe(false)
  })

  it('keeps Dobius tours available on the Board (the default view)', () => {
    expect(
      shouldSuppressContextualTours({
        activeView: 'board',
        onboarding: completedOnboarding,
        onboardingLoaded: true
      })
    ).toBe(false)
  })
})
