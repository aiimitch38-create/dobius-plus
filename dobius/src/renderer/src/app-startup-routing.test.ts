import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string): string =>
  readFileSync(join(process.cwd(), relativePath), 'utf8')

describe('renderer startup runtime routing', () => {
  it('loads settings before repo and worktree hydration', () => {
    const source = read('src/renderer/src/hooks/useWorkspaceStartupHydration.ts')
    const startupBlockStart = source.indexOf('void (async () => {')
    const startupBlockEnd = source.indexOf('const persistedUI = await uiGetPromise')
    const startupBlock = source.slice(startupBlockStart, startupBlockEnd)

    const settingsIndex = startupBlock.indexOf('actions.fetchSettings()')
    expect(settingsIndex).toBeGreaterThanOrEqual(0)
    expect(settingsIndex).toBeLessThan(startupBlock.indexOf('actions.fetchReposForAllHosts()'))
    expect(settingsIndex).toBeLessThan(startupBlock.indexOf('actions.fetchAllWorktrees()'))
  })

  it('overlaps sidebar scope loads with worktree hydration before session hydration', () => {
    const source = read('src/renderer/src/hooks/useWorkspaceStartupHydration.ts')
    const startupBlockStart = source.indexOf('void (async () => {')
    const startupBlockEnd = source.indexOf('const persistedUI = await uiGetPromise')
    const startupBlock = source.slice(startupBlockStart, startupBlockEnd)

    const reposIndex = startupBlock.indexOf('actions.fetchReposForAllHosts()')
    const scopeChainIndex = startupBlock.indexOf('const projectScopeChain = (async () => {')
    const projectGroupsIndex = startupBlock.indexOf('actions.fetchProjectGroupsForAllHosts()')
    const folderWorkspacesIndex = startupBlock.indexOf('actions.fetchFolderWorkspacesForAllHosts()')
    const promiseAllIndex = startupBlock.indexOf('await Promise.all([')
    const awaitedScopeChainIndex = startupBlock.indexOf('projectScopeChain', promiseAllIndex)
    const worktreesIndex = startupBlock.indexOf('actions.fetchAllWorktrees()')
    const lineageIndex = startupBlock.indexOf('actions.fetchWorktreeLineage()')

    expect(reposIndex).toBeGreaterThanOrEqual(0)
    expect(scopeChainIndex).toBeGreaterThan(reposIndex)
    expect(projectGroupsIndex).toBeGreaterThan(scopeChainIndex)
    expect(folderWorkspacesIndex).toBeGreaterThan(projectGroupsIndex)
    expect(promiseAllIndex).toBeGreaterThan(scopeChainIndex)
    expect(awaitedScopeChainIndex).toBeGreaterThan(promiseAllIndex)
    expect(worktreesIndex).toBeGreaterThan(promiseAllIndex)
    expect(lineageIndex).toBeGreaterThan(promiseAllIndex)
  })

  it('waits for first-window startup services before terminal reconnect', () => {
    const source = read('src/renderer/src/hooks/useWorkspaceStartupHydration.ts')
    const reconnectIndex = source.indexOf('await actions.reconnectPersistedTerminals')
    const servicesIndex = source.indexOf('await window.api.app.awaitFirstWindowStartupServices()')

    expect(servicesIndex).toBeGreaterThanOrEqual(0)
    expect(servicesIndex).toBeLessThan(reconnectIndex)
  })

  it('does not eagerly import the floating terminal panel on startup', () => {
    const shellSource = read('src/renderer/src/components/app-shell/AppWorkspaceShell.tsx')
    const lazyPagesSource = read('src/renderer/src/app-lazy-pages.ts')
    const overlaysSource = read('src/renderer/src/components/app-shell/AppRootOverlays.tsx')

    expect(shellSource).toContain(
      "import { FloatingTerminalToggleButton } from '../floating-terminal/FloatingTerminalToggleButton'"
    )
    expect(lazyPagesSource).toContain(
      "import('./components/floating-terminal/FloatingTerminalPanel').then"
    )
    expect(shellSource).not.toContain("from './components/floating-terminal/FloatingTerminalPanel'")
    expect(shellSource).not.toContain("from '../floating-terminal/FloatingTerminalPanel'")
    expect(overlaysSource).not.toContain("from '../floating-terminal/FloatingTerminalPanel'")
  })

  it('does not eagerly import idle optional overlay surfaces on startup', () => {
    const appSource = read('src/renderer/src/App.tsx')
    const lazyPagesSource = read('src/renderer/src/app-lazy-pages.ts')
    const overlaysSource = read('src/renderer/src/components/app-shell/AppRootOverlays.tsx')

    expect(lazyPagesSource).toContain("import('./components/UpdateCard').then")
    expect(lazyPagesSource).toContain(
      "import('./components/contextual-tours/ContextualTourOverlay').then"
    )
    expect(lazyPagesSource).toContain(
      "import('./components/setup-guide/SetupGuideTelemetryObserver').then"
    )
    expect(overlaysSource).not.toContain("from '../UpdateCard'")
    expect(overlaysSource).not.toContain("from '../contextual-tours/ContextualTourOverlay'")
    expect(overlaysSource).not.toContain("from '../setup-guide/SetupGuideTelemetryObserver'")
    expect(appSource).toContain('const shouldMountSetupGuideTelemetryObserver = persistedUIReady')
    expect(appSource).not.toContain(
      "const shouldMountSetupGuideTelemetryObserver = persistedUIReady && activeModal === 'setup-guide'"
    )
  })

  it('keeps crash-report listeners eager while lazy-loading the dialog surface', () => {
    const overlaysSource = read('src/renderer/src/components/app-shell/AppRootOverlays.tsx')
    const hostSource = read('src/renderer/src/components/crash-report/CrashReportDialog.tsx')

    expect(overlaysSource).toContain(
      "import { CrashReportDialog } from '../crash-report/CrashReportDialog'"
    )
    expect(overlaysSource).not.toContain("from '../crash-report/CrashReportDialogSurface'")
    expect(hostSource).toContain("import('./CrashReportDialogSurface').then")
    expect(hostSource).toContain('window.api.crashReports.getLatestPending()')
    expect(hostSource).toContain('window.api.ui.onOpenCrashReport')
    expect(hostSource).toContain('REACT_ERROR_BOUNDARY_REPORT_AVAILABLE_EVENT')
    expect(hostSource).toContain('if (!open) {')
    expect(hostSource).not.toContain('if (!open && !loading)')
  })

  it('clears stale crash-report state before opening the lazy manual report surface', () => {
    const hostSource = read('src/renderer/src/components/crash-report/CrashReportDialog.tsx')
    const manualOpenStart = hostSource.indexOf('return window.api.ui.onOpenCrashReport(() => {')
    const manualOpenEnd = hostSource.indexOf('  }, [loadCrashReport])', manualOpenStart)
    const manualOpenBlock = hostSource.slice(manualOpenStart, manualOpenEnd)

    expect(manualOpenBlock.indexOf('setReport(null)')).toBeGreaterThanOrEqual(0)
    expect(manualOpenBlock.indexOf('setReport(null)')).toBeLessThan(
      manualOpenBlock.indexOf('setOpen(true)')
    )
    expect(manualOpenBlock.indexOf('setReport(null)')).toBeLessThan(
      manualOpenBlock.indexOf('loadCrashReport(false)')
    )
  })

  it('loads dictation only when voice is enabled or a session is active', () => {
    const appSource = read('src/renderer/src/App.tsx')
    const lazyPagesSource = read('src/renderer/src/app-lazy-pages.ts')
    const overlaysSource = read('src/renderer/src/components/app-shell/AppRootOverlays.tsx')

    expect(lazyPagesSource).toContain("import('./components/dictation/DictationController').then")
    expect(overlaysSource).not.toContain("from '../dictation/DictationController'")
    expect(appSource).toContain("settings?.voice?.enabled === true || dictationState !== 'idle'")
    expect(overlaysSource).toContain('shouldMountDictationController ?')
  })

  it('loads the SSH passphrase dialog only when a credential request is queued', () => {
    const lazyPagesSource = read('src/renderer/src/app-lazy-pages.ts')
    const overlaysSource = read('src/renderer/src/components/app-shell/AppRootOverlays.tsx')
    const storeStateSource = read('src/renderer/src/hooks/useAppShellStoreState.ts')

    expect(lazyPagesSource).toContain("import('./components/settings/SshPassphraseDialog').then")
    expect(overlaysSource).not.toContain("from '../settings/SshPassphraseDialog'")
    expect(storeStateSource).toContain('s.sshCredentialQueue.length > 0')
    expect(overlaysSource).toContain('hasSshCredentialRequest ?')
  })

  it('defers background polling until the workspace session is ready', () => {
    const source = read('src/renderer/src/App.tsx')

    expect(source).toContain('useGitStatusPolling({ enabled: workspaceSessionReady })')
    expect(source).toContain('<WorkspacePortScanner enabled={workspaceSessionReady} />')
  })

  it('does not load the terminal workbench on the no-workspace landing path', () => {
    const appSource = read('src/renderer/src/App.tsx')
    const lazyPagesSource = read('src/renderer/src/app-lazy-pages.ts')
    const stickyMountSource = read('src/renderer/src/hooks/useStickyMount.ts')
    const shellSource = read('src/renderer/src/components/app-shell/AppWorkspaceShell.tsx')

    expect(lazyPagesSource).toContain("export const Terminal = lazy(() => import('./components/Terminal'))")
    expect(shellSource).not.toContain("from '../Terminal'")
    // Why: once-mounted stickiness is shared logic (useStickyMount), not
    // reimplemented per surface — assert the shared hook's ref pattern and
    // that App wires the terminal workbench through it.
    expect(stickyMountSource).toContain('const hasMountedRef = useRef(false)')
    expect(stickyMountSource).toContain('return active || hasMountedRef.current')
    expect(appSource).toContain(
      'const shouldMountTerminalWorkbench = useStickyMount(activeWorktreeId !== null)'
    )
    expect(shellSource).toContain('shouldMountTerminalWorkbench ?')
  })

  it('keeps the new-workspace composer eager because it is a critical create surface', () => {
    const overlaysSource = read('src/renderer/src/components/app-shell/AppRootOverlays.tsx')
    const lazyPagesSource = read('src/renderer/src/app-lazy-pages.ts')
    const lazyModalSource = read('src/renderer/src/lazy-modal-mount-state.ts')

    expect(overlaysSource).toContain(
      "import NewWorkspaceComposerModal from '../NewWorkspaceComposerModal'"
    )
    expect(lazyPagesSource).not.toContain("import('./components/NewWorkspaceComposerModal')")
    expect(overlaysSource).toContain("activeModal === 'new-workspace-composer'")
    expect(lazyModalSource).not.toContain("'new-workspace-composer'")
  })

  it('does not eagerly import inactive sidebar dialog flows on startup', () => {
    const lazyPagesSource = read('src/renderer/src/app-lazy-pages.ts')
    const overlaysSource = read('src/renderer/src/components/app-shell/AppRootOverlays.tsx')
    const mountGateSource = read('src/renderer/src/hooks/useAddRepoDialogMountGate.ts')
    const sidebarSource = read('src/renderer/src/components/sidebar/index.tsx')

    expect(lazyPagesSource).toContain("lazy(() => import('./components/sidebar/AddRepoDialog'))")
    expect(lazyPagesSource).toContain(
      "lazy(() => import('./components/sidebar/NonGitFolderDialog'))"
    )
    expect(lazyPagesSource).toContain("import('./components/sidebar/AddProjectFromFolderDialog')")
    expect(lazyPagesSource).toContain(
      "lazy(() => import('./components/sidebar/ProjectAddedDialog'))"
    )
    expect(overlaysSource).toContain("activeModal === 'add-repo'")
    expect(overlaysSource).toContain("activeModal === 'confirm-non-git-folder'")
    expect(overlaysSource).toContain("activeModal === 'confirm-add-project-from-folder'")
    expect(overlaysSource).toContain("activeModal === 'project-added'")
    expect(overlaysSource).toContain('shouldMountAddRepoDialog ? (')
    expect(overlaysSource).toContain('boundaryId="modal.add-repo"')
    expect(overlaysSource).toContain('boundaryId="modal.confirm-non-git-folder"')
    expect(overlaysSource).toContain('boundaryId="modal.confirm-add-project-from-folder"')
    expect(overlaysSource).toContain('boundaryId="modal.project-added"')
    expect(mountGateSource).toContain('setTimeout(() =>')
    expect(sidebarSource).toContain("lazyWithRetry(() => import('./WorktreeMetaDialog'))")
    expect(sidebarSource).not.toContain("from './AddRepoDialog'")
    expect(sidebarSource).not.toContain("React.lazy(() => import('./AddRepoDialog'))")
    expect(sidebarSource).not.toContain("React.lazy(() => import('./NonGitFolderDialog'))")
    expect(sidebarSource).not.toContain("React.lazy(() => import('./AddProjectFromFolderDialog'))")
    expect(sidebarSource).not.toContain("React.lazy(() => import('./ProjectAddedDialog'))")
    expect(sidebarSource).not.toContain('shouldMountAddRepoDialog ? <AddRepoDialog /> : null')
    expect(sidebarSource).not.toContain(
      "activeModal === 'confirm-non-git-folder' ? <NonGitFolderDialog /> : null"
    )
    expect(sidebarSource).not.toContain(
      "activeModal === 'confirm-add-project-from-folder' ? <AddProjectFromFolderDialog /> : null"
    )
    expect(sidebarSource).not.toContain(
      "activeModal === 'project-added' ? <ProjectAddedDialog /> : null"
    )
    expect(sidebarSource).toContain("activeModal === 'edit-meta' ? <WorktreeMetaDialog /> : null")
    expect(sidebarSource).toContain(
      "activeModal === 'confirm-remove-folder' ? <RemoveFolderDialog /> : null"
    )
  })

  it('does not eagerly import optional status-bar segments on startup', () => {
    const source = read('src/renderer/src/components/status-bar/StatusBar.tsx')

    expect(source).toContain("import('./ResourceUsageStatusSegment').then")
    expect(source).toContain("import('./PortsStatusSegment').then")
    expect(source).toContain("import('./SshStatusSegment').then")
    expect(source).toContain("import('./PetStatusSegment').then")
    expect(source).not.toContain("from './ResourceUsageStatusSegment'")
    expect(source).not.toContain("from './PortsStatusSegment'")
    expect(source).not.toContain("from './SshStatusSegment'")
    expect(source).not.toContain("from './PetStatusSegment'")
  })

  it('does not eagerly import the status bar shell on startup', () => {
    const lazyPagesSource = read('src/renderer/src/app-lazy-pages.ts')
    const overlaysSource = read('src/renderer/src/components/app-shell/AppRootOverlays.tsx')

    expect(lazyPagesSource).toContain("import('./components/status-bar/StatusBar').then")
    expect(overlaysSource).not.toContain("from '../status-bar/StatusBar'")
    expect(overlaysSource).toContain('statusBarVisible ? (')
    expect(overlaysSource).toContain('h-6 min-h-[24px] shrink-0 border-t border-border')
  })
})
