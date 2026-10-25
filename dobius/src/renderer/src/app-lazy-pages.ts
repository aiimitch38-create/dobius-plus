// Lazy-loaded page, dialog, and overlay components mounted from App.tsx.
// Kept in one module so App.tsx's own line count reflects app-shell logic,
// not this declaration list.
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'

export const Landing = lazy(() => import('./components/Landing'))
export const BoardRoute = lazy(() => import('./components/board/BoardRoute'))
export const BoardHome = lazy(() => import('./components/board/board-home/BoardHome'))
// Why: the Board and Home are the only surfaces the user sees under the Board
// look; fetching their chunks at app start keeps the Suspense cover to a frame.
// Vite dedupes these specifiers with the lazy() ones above, and a failure here
// is harmless: the lazy() retry path still owns real load errors.
export function prefetchBoardSurfaces(): void {
  void import('./components/board/BoardRoute').catch((error: unknown) =>
    console.warn('[board] BoardRoute prefetch failed', error)
  )
  void import('./components/board/board-home/BoardHome').catch((error: unknown) =>
    console.warn('[board] BoardHome prefetch failed', error)
  )
}
export const HomePage = lazy(() => import('./components/home/HomePage'))
export const WorktreeCreationPanel = lazy(
  () => import('./components/worktree-creation/WorktreeCreationPanel')
)
export const TaskPage = lazy(() => import('./components/TaskPage'))
export const AutomationsPage = lazy(() => import('./components/automations/AutomationsPage'))
export const ActivityPrototypePage = lazy(
  () => import('./components/activity/ActivityPrototypePage')
)
export const Settings = lazy(() => import('./components/settings/Settings'))
export const SkillsPage = lazy(() => import('./components/skills/SkillsPage'))
export const AgentsPage = lazy(() => import('./components/agents/AgentsPage'))
// The restored Communications client. Lazy so its dependency tree (router,
// query, editor, syntax highlighting) stays out of the initial bundle.
export const BuzzPage = lazy(() => import('./components/communications/CommunicationsPage'))
export const WorkspaceSpacePage = lazy(
  () => import('./components/workspace-space/WorkspaceSpacePage')
)
export const MobilePage = lazy(() => import('./components/mobile/MobilePage'))
export const QuickOpen = lazy(() => import('./components/QuickOpen'))
export const WorktreeJumpPalette = lazy(() => import('./components/WorktreeJumpPalette'))
export const WorkspaceCleanupDialog = lazy(
  () => import('./components/workspace-cleanup/WorkspaceCleanupDialog')
)
export const Terminal = lazy(() => import('./components/Terminal'))
export const StatusBar = lazy(() =>
  import('./components/status-bar/StatusBar').then((module) => ({ default: module.StatusBar }))
)
export const SetupGuideModal = lazy(() => import('./components/setup-guide/SetupGuideModal'))
export const FeatureWallModal = lazy(() => import('./components/feature-wall/FeatureWallModal'))
export const FeatureTipsModal = lazy(() => import('./components/feature-tips/FeatureTipsModal'))
export const AddRepoDialog = lazy(() => import('./components/sidebar/AddRepoDialog'))
export const NonGitFolderDialog = lazy(() => import('./components/sidebar/NonGitFolderDialog'))
export const AddProjectFromFolderDialog = lazy(
  () => import('./components/sidebar/AddProjectFromFolderDialog')
)
export const ProjectAddedDialog = lazy(() => import('./components/sidebar/ProjectAddedDialog'))
export const DeleteWorktreeDialog = lazy(() => import('./components/sidebar/DeleteWorktreeDialog'))
export const DictationController = lazy(() =>
  import('./components/dictation/DictationController').then((module) => ({
    default: module.DictationController
  }))
)
export const SshPassphraseDialog = lazy(() =>
  import('./components/settings/SshPassphraseDialog').then((module) => ({
    default: module.SshPassphraseDialog
  }))
)
export const UpdateCard = lazy(() =>
  import('./components/UpdateCard').then((module) => ({ default: module.UpdateCard }))
)
export const ContextualTourOverlay = lazy(() =>
  import('./components/contextual-tours/ContextualTourOverlay').then((module) => ({
    default: module.ContextualTourOverlay
  }))
)
export const SetupGuideTelemetryObserver = lazy(() =>
  import('./components/setup-guide/SetupGuideTelemetryObserver').then((module) => ({
    default: module.SetupGuideTelemetryObserver
  }))
)
export const FloatingTerminalPanel = lazy(() =>
  import('./components/floating-terminal/FloatingTerminalPanel').then((module) => ({
    default: module.FloatingTerminalPanel
  }))
)
// Why: lazy-loaded so the WebP asset + overlay module aren't fetched unless
// the user opts into the experimental flag.
export const PetOverlay = lazy(() => import('./components/pet/PetOverlay'))
// Why: lazy so onboarding's step modules + assets aren't fetched for users
// past first-launch. The gate `shouldShowOnboarding` lives in its own tiny
// module so no eager import path pulls OnboardingFlow into the main chunk.
export const OnboardingFlow = lazy(() => import('./components/onboarding/OnboardingFlow'))
