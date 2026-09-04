import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { AppState } from '@/store'
import { onOnboardingReopened } from '../components/onboarding/show-onboarding-event'
import { shouldShowOnboarding } from '../components/onboarding/should-show-onboarding'
import {
  getFeatureTipsAppOpenDecision,
  isCliFeatureTipCompleted
} from '../components/feature-tips/feature-tip-startup-gate'
import {
  trackCmdJPaletteFeatureTipShown,
  trackDobiusCliFeatureTipShown
} from '../components/feature-tips/feature-tip-telemetry'
import type { OnboardingState } from '../../../shared/types'

type OnboardingGateActions = Pick<
  AppState,
  | 'setContextualToursOnboardingVisible'
  | 'setContextualToursAutoEligible'
  | 'markFeatureTipsSeen'
  | 'openModal'
>

export type UseOnboardingAndFeatureTipsGateParams = {
  activeView: AppState['activeView']
  activeModal: AppState['activeModal']
  featureTipsSeenIds: AppState['featureTipsSeenIds']
  featureInteractions: AppState['featureInteractions']
  contextualToursAutoEligible: AppState['contextualToursAutoEligible']
  persistedUIReady: boolean
  settings: AppState['settings']
  actions: OnboardingGateActions
}

export type UseOnboardingAndFeatureTipsGateResult = {
  onboarding: OnboardingState | null
  setOnboarding: Dispatch<SetStateAction<OnboardingState | null>>
  onboardingLoaded: boolean
  setOnboardingLoaded: Dispatch<SetStateAction<boolean>>
  shouldRenderOnboarding: boolean
  onboardingSettingsDetourActive: boolean
  beginOnboardingSettingsDetour: () => void
}

export function useOnboardingAndFeatureTipsGate({
  activeView,
  activeModal,
  featureTipsSeenIds,
  featureInteractions,
  contextualToursAutoEligible,
  persistedUIReady,
  settings,
  actions
}: UseOnboardingAndFeatureTipsGateParams): UseOnboardingAndFeatureTipsGateResult {
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null)
  const [onboardingLoaded, setOnboardingLoaded] = useState(false)
  const featureTipsPromptedThisSessionRef = useRef(false)
  const featureTipsSuppressedByOnboardingThisSessionRef = useRef(false)
  const [featureTipCliInstalled, setFeatureTipCliInstalled] = useState<boolean | null>(null)
  const [onboardingSettingsDetour, setOnboardingSettingsDetour] = useState(false)
  const shouldRenderOnboarding = onboarding !== null && shouldShowOnboarding(onboarding)
  const onboardingSettingsDetourActive =
    onboardingSettingsDetour && activeView === 'settings' && shouldRenderOnboarding
  if (onboardingSettingsDetour && !onboardingSettingsDetourActive) {
    // Why: the settings detour is valid only while Settings is onscreen; clear
    // it during render so onboarding can resume without a follow-up Effect pass.
    setOnboardingSettingsDetour(false)
  }

  useEffect(() => {
    return onOnboardingReopened(setOnboarding)
  }, [])

  useEffect(() => {
    // Why: `onboarding === null` is the startup loading state. Suppress
    // contextual tours until the persisted onboarding state is known so a
    // first-run user cannot have a tour marked seen before onboarding appears.
    const suppressTours = !onboardingLoaded || shouldShowOnboarding(onboarding)
    actions.setContextualToursOnboardingVisible(suppressTours)
  }, [actions, onboarding, onboardingLoaded])

  useEffect(() => {
    if (!persistedUIReady || !onboardingLoaded || contextualToursAutoEligible !== null) {
      return
    }
    // Why: this rollout is for users who are still in first-run onboarding.
    // Existing profiles are locally classified once and never auto-toured.
    actions.setContextualToursAutoEligible(shouldShowOnboarding(onboarding))
  }, [actions, contextualToursAutoEligible, onboarding, onboardingLoaded, persistedUIReady])

  useEffect(() => {
    if (!persistedUIReady) {
      return
    }

    let cancelled = false
    void window.api.cli
      .getInstallStatus()
      .then((status) => {
        if (cancelled) {
          return
        }
        setFeatureTipCliInstalled(isCliFeatureTipCompleted(status))
      })
      .catch(() => {
        if (!cancelled) {
          setFeatureTipCliInstalled(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [persistedUIReady])

  useEffect(() => {
    const featureTipsDecision = getFeatureTipsAppOpenDecision({
      activeModal,
      cliInstalled: featureTipCliInstalled,
      featureTipsSeenIds,
      featureInteractions,
      onboarding,
      persistedUIReady,
      promptedThisSession: featureTipsPromptedThisSessionRef.current,
      settings,
      suppressedByOnboardingThisSession: featureTipsSuppressedByOnboardingThisSessionRef.current
    })

    if (featureTipsDecision.kind === 'suppress-for-onboarding') {
      // Why: first-download users should finish onboarding without a second
      // education modal appearing later in the same first-run session.
      featureTipsSuppressedByOnboardingThisSessionRef.current = true
      return
    }

    if (featureTipsDecision.kind !== 'open') {
      return
    }

    featureTipsPromptedThisSessionRef.current = true
    if (featureTipsDecision.tipId === 'dobius-cli') {
      trackDobiusCliFeatureTipShown('app_open')
    } else if (featureTipsDecision.tipId === 'cmd-j-palette') {
      trackCmdJPaletteFeatureTipShown('app_open')
    }
    // Why: once a tip is visible, app quit/crash should not make it reappear
    // on the next launch just because the user never clicked a dismiss button.
    actions.markFeatureTipsSeen([featureTipsDecision.tipId])
    actions.openModal('feature-tips', { source: 'app_open', tipId: featureTipsDecision.tipId })
  }, [
    activeModal,
    actions,
    featureTipCliInstalled,
    featureInteractions,
    featureTipsSeenIds,
    onboarding,
    persistedUIReady,
    settings
  ])

  const beginOnboardingSettingsDetour = useCallback(() => {
    setOnboardingSettingsDetour(true)
  }, [])

  return {
    onboarding,
    setOnboarding,
    onboardingLoaded,
    setOnboardingLoaded,
    shouldRenderOnboarding,
    onboardingSettingsDetourActive,
    beginOnboardingSettingsDetour
  }
}
