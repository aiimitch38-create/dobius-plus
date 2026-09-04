import { Suspense, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { AppState } from '@/store'
import { translate } from '@/i18n/i18n'
import { RecoverableRenderErrorBoundary } from '../error-boundaries/RecoverableRenderErrorBoundary'
import { TelemetryFirstLaunchSurface } from '../TelemetryFirstLaunchSurface'
import { ZoomOverlay } from '../ZoomOverlay'
import { CrashReportDialog } from '../crash-report/CrashReportDialog'
import { MarkdownTemplatePicker } from '../editor/MarkdownTemplatePicker'
import NewWorkspaceComposerModal from '../NewWorkspaceComposerModal'
import RecentTabSwitcher from '../tab-bar/RecentTabSwitcher'
import type { LazyModalId } from '../../lazy-modal-mount-state'
import type { FloatingWorkspaceTourInteractionSnapshot } from '@/lib/floating-workspace-tour-interaction-snapshot'
import type { OnboardingState } from '../../../../shared/types'
import {
  QuickOpen,
  WorktreeJumpPalette,
  WorkspaceCleanupDialog,
  StatusBar,
  SetupGuideModal,
  FeatureWallModal,
  FeatureTipsModal,
  AddRepoDialog,
  NonGitFolderDialog,
  AddProjectFromFolderDialog,
  ProjectAddedDialog,
  DeleteWorktreeDialog,
  DictationController,
  SshPassphraseDialog,
  UpdateCard,
  ContextualTourOverlay,
  SetupGuideTelemetryObserver,
  FloatingTerminalPanel,
  PetOverlay,
  OnboardingFlow
} from '../../app-lazy-pages'

export type AppRootOverlaysProps = {
  shouldMountFloatingTerminalPanel: boolean
  floatingTerminalOpen: boolean
  setFloatingTerminalOpenWithFocus: (nextOpen: SetStateAction<boolean>) => void
  floatingWorkspaceTourInteractionSnapshotRef: RefObject<FloatingWorkspaceTourInteractionSnapshot | null>
  statusBarVisible: boolean
  activeView: AppState['activeView']
  activeModal: AppState['activeModal']
  shouldMountAddRepoDialog: boolean
  resolvedMountedLazyModalIds: ReadonlySet<LazyModalId>
  shouldMountSetupGuideTelemetryObserver: boolean
  shouldMountContextualTourOverlay: boolean
  renderPetOverlay: boolean
  petVisible: boolean
  shouldMountUpdateCard: boolean
  telemetryOptedIn: boolean | null | undefined
  hasSshCredentialRequest: boolean
  onboarding: OnboardingState | null
  shouldRenderOnboarding: boolean
  onboardingSettingsDetourActive: boolean
  setOnboarding: Dispatch<SetStateAction<OnboardingState | null>>
  beginOnboardingSettingsDetour: () => void
  shouldMountDictationController: boolean
  showFloatingTerminalButton: boolean
}

// Why: the root-level overlay/modal stack (floating workspace panel, status
// bar, and every app-root modal/overlay). Extracted as one component since
// these all mount as flat siblings under App's shared provider tree with no
// layout relationship between them — unlike AppWorkspaceShell, there is no
// single wrapping error boundary to preserve, just a long flat list.
export function AppRootOverlays({
  shouldMountFloatingTerminalPanel,
  floatingTerminalOpen,
  setFloatingTerminalOpenWithFocus,
  floatingWorkspaceTourInteractionSnapshotRef,
  statusBarVisible,
  activeView,
  activeModal,
  shouldMountAddRepoDialog,
  resolvedMountedLazyModalIds,
  shouldMountSetupGuideTelemetryObserver,
  shouldMountContextualTourOverlay,
  renderPetOverlay,
  petVisible,
  shouldMountUpdateCard,
  telemetryOptedIn,
  hasSshCredentialRequest,
  onboarding,
  shouldRenderOnboarding,
  onboardingSettingsDetourActive,
  setOnboarding,
  beginOnboardingSettingsDetour,
  shouldMountDictationController,
  showFloatingTerminalButton
}: AppRootOverlaysProps): React.JSX.Element {
  return (
    <>
      {shouldMountFloatingTerminalPanel ? (
        <Suspense fallback={null}>
          <RecoverableRenderErrorBoundary
            boundaryId="overlay.floating-workspace"
            surface="overlay"
            resetKey={floatingTerminalOpen}
            compact
            title={translate('auto.App.1b3024bcd6', 'The floating workspace hit an error.')}
            description={translate(
              'auto.App.7cbfbf622f',
              'Retry the floating workspace or close and reopen it.'
            )}
          >
            <FloatingTerminalPanel
              open={floatingTerminalOpen}
              onOpenChange={setFloatingTerminalOpenWithFocus}
              tourInteractionSnapshot={floatingWorkspaceTourInteractionSnapshotRef.current}
            />
          </RecoverableRenderErrorBoundary>
        </Suspense>
      ) : null}
      {statusBarVisible ? (
        <Suspense
          fallback={
            <div className="h-6 min-h-[24px] shrink-0 border-t border-border bg-[var(--bg-titlebar,var(--card))]" />
          }
        >
          <RecoverableRenderErrorBoundary
            boundaryId="overlay.status-bar"
            surface="overlay"
            resetKey={activeView}
            compact
            title={translate('auto.App.2e8ff36f94', 'The status bar hit an error.')}
            description={translate(
              'auto.App.8a023cea1f',
              'Retry the status bar to remount its controls.'
            )}
          >
            <StatusBar floatingTerminalOpen={floatingTerminalOpen} />
          </RecoverableRenderErrorBoundary>
        </Suspense>
      ) : null}
      {/* Why: workspace creation is a core action; keeping it in the
      entry bundle avoids stale/corrupt lazy chunks stranding users at Create. */}
      {activeModal === 'new-workspace-composer' ? (
        <RecoverableRenderErrorBoundary
          boundaryId="modal.new-workspace-composer"
          surface="modal"
          resetKey
          compact
        >
          <NewWorkspaceComposerModal />
        </RecoverableRenderErrorBoundary>
      ) : null}
      <Suspense fallback={null}>
        {shouldMountAddRepoDialog ? (
          <RecoverableRenderErrorBoundary
            boundaryId="modal.add-repo"
            surface="modal"
            resetKey={activeModal === 'add-repo'}
            compact
          >
            <AddRepoDialog />
          </RecoverableRenderErrorBoundary>
        ) : null}
        {/* Why: Settings can start Add Project without mounting Sidebar,
        so Add Project handoff dialogs must share the root host. */}
        {activeModal === 'confirm-non-git-folder' ? (
          <RecoverableRenderErrorBoundary
            boundaryId="modal.confirm-non-git-folder"
            surface="modal"
            resetKey
            compact
          >
            <NonGitFolderDialog />
          </RecoverableRenderErrorBoundary>
        ) : null}
        {activeModal === 'confirm-add-project-from-folder' ? (
          <RecoverableRenderErrorBoundary
            boundaryId="modal.confirm-add-project-from-folder"
            surface="modal"
            resetKey
            compact
          >
            <AddProjectFromFolderDialog />
          </RecoverableRenderErrorBoundary>
        ) : null}
        {activeModal === 'project-added' ? (
          <RecoverableRenderErrorBoundary
            boundaryId="modal.project-added"
            surface="modal"
            resetKey
            compact
          >
            <ProjectAddedDialog />
          </RecoverableRenderErrorBoundary>
        ) : null}
      </Suspense>
      {/* Why: root overlays can render Radix <Tooltip>s; keep them inside
      the shared provider so lazy surfaces mount safely from any entry point. */}
      <Suspense fallback={null}>
        {resolvedMountedLazyModalIds.has('workspace-cleanup') ? (
          <RecoverableRenderErrorBoundary
            boundaryId="modal.workspace-cleanup"
            surface="modal"
            resetKey={activeModal === 'workspace-cleanup'}
            compact
          >
            <WorkspaceCleanupDialog />
          </RecoverableRenderErrorBoundary>
        ) : null}
      </Suspense>
      <Suspense fallback={null}>
        {resolvedMountedLazyModalIds.has('quick-open') ? (
          <RecoverableRenderErrorBoundary
            boundaryId="modal.quick-open"
            surface="modal"
            resetKey={activeModal === 'quick-open'}
            compact
          >
            <QuickOpen />
          </RecoverableRenderErrorBoundary>
        ) : null}
        {resolvedMountedLazyModalIds.has('worktree-palette') ? (
          <RecoverableRenderErrorBoundary
            boundaryId="modal.worktree-palette"
            surface="modal"
            resetKey={activeModal === 'worktree-palette'}
            compact
          >
            <WorktreeJumpPalette />
          </RecoverableRenderErrorBoundary>
        ) : null}
        {resolvedMountedLazyModalIds.has('setup-guide') ? (
          <RecoverableRenderErrorBoundary
            boundaryId="modal.setup-guide"
            surface="modal"
            resetKey={activeModal === 'setup-guide'}
            compact
          >
            <SetupGuideModal />
          </RecoverableRenderErrorBoundary>
        ) : null}
        {resolvedMountedLazyModalIds.has('feature-wall') ? (
          <RecoverableRenderErrorBoundary
            boundaryId="modal.feature-wall"
            surface="modal"
            resetKey={activeModal === 'feature-wall'}
            compact
          >
            <FeatureWallModal />
          </RecoverableRenderErrorBoundary>
        ) : null}
        {resolvedMountedLazyModalIds.has('feature-tips') ? (
          <RecoverableRenderErrorBoundary
            boundaryId="modal.feature-tips"
            surface="modal"
            resetKey={activeModal === 'feature-tips'}
            compact
          >
            <FeatureTipsModal />
          </RecoverableRenderErrorBoundary>
        ) : null}
      </Suspense>
      {shouldMountSetupGuideTelemetryObserver ? (
        <Suspense fallback={null}>
          <SetupGuideTelemetryObserver />
        </Suspense>
      ) : null}
      {shouldMountContextualTourOverlay ? (
        <Suspense fallback={null}>
          <ContextualTourOverlay />
        </Suspense>
      ) : null}
      {/* Why: mount PetOverlay only after persisted UI hydration, with
    both independent pet toggles allowing it; otherwise a hidden pet
    flashes while the store still has default visibility. */}
      {renderPetOverlay ? (
        <Suspense fallback={null}>
          <RecoverableRenderErrorBoundary
            boundaryId="overlay.pet"
            surface="overlay"
            resetKey={petVisible}
            compact
          >
            <PetOverlay />
          </RecoverableRenderErrorBoundary>
        </Suspense>
      ) : null}
      {shouldMountUpdateCard ? (
        <Suspense fallback={null}>
          <RecoverableRenderErrorBoundary
            boundaryId="overlay.update-card"
            surface="overlay"
            resetKey={activeView}
            compact
          >
            <UpdateCard />
          </RecoverableRenderErrorBoundary>
        </Suspense>
      ) : null}
      {/* Why: the existing-user opt-in banner mounts at App root so it
    renders once per renderer session, not per view. It gates
    internally on the cohort markers populated by the migration,
    so it only shows for users who installed before the telemetry
    release and have not yet resolved consent. New users get no
    first-launch surface — see telemetry-plan.md §First-launch
    experience. */}
      <RecoverableRenderErrorBoundary
        boundaryId="overlay.telemetry-first-launch"
        surface="overlay"
        resetKey={telemetryOptedIn ?? 'unknown'}
        compact
      >
        <TelemetryFirstLaunchSurface />
      </RecoverableRenderErrorBoundary>
      <RecoverableRenderErrorBoundary
        boundaryId="overlay.zoom"
        surface="overlay"
        resetKey={activeView}
        compact
      >
        <ZoomOverlay />
      </RecoverableRenderErrorBoundary>
      <Suspense fallback={null}>
        {activeModal === 'delete-worktree' ? (
          <RecoverableRenderErrorBoundary
            boundaryId="modal.delete-worktree"
            surface="modal"
            resetKey
            compact
          >
            <DeleteWorktreeDialog />
          </RecoverableRenderErrorBoundary>
        ) : null}
      </Suspense>
      {hasSshCredentialRequest ? (
        <Suspense fallback={null}>
          <RecoverableRenderErrorBoundary
            boundaryId="modal.ssh-passphrase"
            surface="modal"
            resetKey={activeModal}
            compact
          >
            <SshPassphraseDialog />
          </RecoverableRenderErrorBoundary>
        </Suspense>
      ) : null}
      <RecoverableRenderErrorBoundary
        boundaryId="modal.markdown-template-picker"
        surface="modal"
        resetKey={activeModal}
        compact
      >
        <MarkdownTemplatePicker />
      </RecoverableRenderErrorBoundary>
      <RecoverableRenderErrorBoundary
        boundaryId="modal.crash-report"
        surface="modal"
        reportAsCrash={false}
        resetKey={activeModal}
        compact
        title={translate('auto.App.722d03aa62', 'The crash report dialog hit an error.')}
        description={translate(
          'auto.App.acd66311dc',
          'Use the Help menu after retrying if you still need diagnostics.'
        )}
      >
        <CrashReportDialog />
      </RecoverableRenderErrorBoundary>
      {onboarding && shouldRenderOnboarding && !onboardingSettingsDetourActive ? (
        <Suspense fallback={null}>
          <RecoverableRenderErrorBoundary
            boundaryId="modal.onboarding"
            surface="modal"
            resetKey={onboardingSettingsDetourActive}
            title={translate('auto.App.f02d37278a', 'Onboarding hit an error.')}
            description={translate(
              'auto.App.221a95ba38',
              'Retry onboarding or close it and continue in the app.'
            )}
          >
            <OnboardingFlow
              onboarding={onboarding}
              onOnboardingChange={setOnboarding}
              onSettingsDetourStart={beginOnboardingSettingsDetour}
            />
          </RecoverableRenderErrorBoundary>
        </Suspense>
      ) : null}
      {shouldMountDictationController ? (
        <Suspense fallback={null}>
          <RecoverableRenderErrorBoundary
            boundaryId="overlay.dictation"
            surface="overlay"
            resetKey={activeView}
            compact
          >
            <DictationController hideOwnOrb={showFloatingTerminalButton} />
          </RecoverableRenderErrorBoundary>
        </Suspense>
      ) : null}
      <RecoverableRenderErrorBoundary
        boundaryId="overlay.recent-tab-switcher"
        surface="overlay"
        resetKey={activeView}
        compact
      >
        <RecentTabSwitcher />
      </RecoverableRenderErrorBoundary>
    </>
  )
}
