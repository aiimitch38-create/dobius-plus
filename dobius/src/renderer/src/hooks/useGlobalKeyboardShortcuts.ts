import { useEffect, useRef, type SetStateAction } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store'
import { canShowRightSidebarForView } from '@/lib/right-sidebar-visibility'
import {
  isFloatingWorkspacePanelFocused,
  isFloatingWorkspacePanelShortcut,
  isFloatingWorkspaceTerminalInputTarget,
  shouldMinimizeFloatingWorkspacePanelOnCloseShortcut
} from '@/lib/floating-workspace-terminal-actions'
import { requestFloatingTerminalOpenMaximized } from '@/lib/floating-terminal'
import { requestScrollToCurrentWorkspaceRevealAndRename } from '@/lib/scroll-to-current-workspace-status'
import { isEditableTarget } from '@/lib/editable-target'
import { getSelectedTextForFileSearch } from '@/lib/file-search-selection'
import {
  folderRelativePathToIncludeGlob,
  selectedExplorerFolderRelativePath
} from '../components/right-sidebar/file-search-include-pattern'
import { shouldShowWorktreeHistoryControls } from '@/lib/titlebar-worktree-history-controls'
import { OPEN_WORKSPACE_BOARD_EVENT } from '../components/sidebar/useWorkspaceBoardPanel'
import {
  keybindingMatchesAction,
  type KeybindingActionId,
  type KeybindingContext,
  type PhysicalModifierToken,
  type TerminalShortcutPolicy
} from '../../../shared/keybindings'
import {
  ModifierDoubleTapDetector,
  toModifierDoubleTapEvent
} from '../../../shared/modifier-double-tap-detector'
import { isGitRepoKind } from '../../../shared/repo-kind'
import { showTerminalShortcutCaptureNotification } from '@/lib/terminal-shortcut-capture-notification'

function getKeybindingContext(target: EventTarget | null): KeybindingContext {
  return target instanceof HTMLElement && target.classList.contains('xterm-helper-textarea')
    ? 'terminal'
    : 'app'
}

// Abstraction over a real KeyboardEvent and a synthetic double-tap gesture so a
// single dispatch path serves both. KeybindingInput-compatible (key/code +
// modifier flags) so it flows straight into keybindingMatchesAction.
type ShortcutDispatchInput = {
  key?: string
  code?: string
  altKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  doubleTapModifier?: PhysicalModifierToken
  target: EventTarget | null
  defaultPrevented: boolean
  preventDefault: () => void
}

type GlobalShortcutActions = Pick<
  AppState,
  | 'showRightSidebarSearch'
  | 'toggleSidebar'
  | 'toggleRightSidebar'
  | 'showRightSidebarFiles'
  | 'setRightSidebarTab'
  | 'setRightSidebarOpen'
>

export type UseGlobalKeyboardShortcutsParams = {
  activeView: AppState['activeView']
  activeWorktreeId: string | null
  actions: GlobalShortcutActions
  floatingTerminalEnabled: boolean
  floatingTerminalOpen: boolean
  floatingVisibleTabCount: number
  keybindings: AppState['keybindings']
  terminalShortcutPolicy: TerminalShortcutPolicy | undefined
  setFloatingTerminalOpenWithFocus: (nextOpen: SetStateAction<boolean>) => void
  workspaceChromeActive: boolean
  creationLayoutActive: boolean
  shortcutPlatform: NodeJS.Platform
}

// Why: window key listeners are global and long-lived; keep one registration
// while letting the handler read current shortcut state on each key event via
// a ref, instead of re-registering the listener on every render.
export function useGlobalKeyboardShortcuts(params: UseGlobalKeyboardShortcutsParams): void {
  const { shortcutPlatform } = params
  const globalShortcutStateRef = useRef(params)
  globalShortcutStateRef.current = params

  useEffect(() => {
    const doubleTapDetector = new ModifierDoubleTapDetector()

    const dispatchShortcutInput = (input: ShortcutDispatchInput): void => {
      const {
        activeView,
        activeWorktreeId,
        actions,
        floatingTerminalEnabled,
        floatingTerminalOpen,
        floatingVisibleTabCount,
        keybindings,
        terminalShortcutPolicy,
        setFloatingTerminalOpenWithFocus,
        workspaceChromeActive,
        creationLayoutActive
      } = globalShortcutStateRef.current

      // Why: child-component handlers (e.g. terminal search Cmd+G / Cmd+Shift+G)
      // register on the same window capture phase and fire first. If they already
      // called preventDefault, this handler must not also act on the event —
      // otherwise both actions execute (e.g. search navigation AND sidebar open).
      if (input.defaultPrevented) {
        return
      }
      // Why: the Settings recorder intentionally captures existing app
      // shortcuts, so global handlers must not fire while its button has focus.
      if (
        input.target instanceof Element &&
        input.target.closest('[data-shortcut-recorder-active]') !== null
      ) {
        return
      }
      const context = getKeybindingContext(input.target)

      // Note: some app-level shortcuts are also intercepted via
      // before-input-event in createMainWindow.ts so they still work when a
      // browser guest has focus. The renderer keeps matching handlers for
      // local-focus cases and to preserve the same guards in one place.

      const matchShortcut = (actionId: KeybindingActionId): boolean =>
        keybindingMatchesAction(actionId, input, shortcutPlatform, keybindings, {
          context,
          terminalShortcutPolicy
        })
      const notifyTerminalCapture = (actionId: KeybindingActionId): void => {
        if (
          context !== 'terminal' ||
          (terminalShortcutPolicy ?? 'dobius-first') !== 'dobius-first'
        ) {
          return
        }
        showTerminalShortcutCaptureNotification({
          actionId,
          platform: shortcutPlatform,
          keybindings
        })
      }

      const canRevealRightSidebar = !creationLayoutActive && canShowRightSidebarForView(activeView)

      const openSearchSidebar = (query: string | null): void => {
        actions.showRightSidebarSearch(query ? { query } : undefined)
      }

      if (matchShortcut('sidebar.search.toggle') && canRevealRightSidebar) {
        // Why: when focus is inside the file explorer and a folder is selected,
        // Cmd/Ctrl+Shift+F means "Find in Folder" — seed the include pattern
        // with that folder instead of treating the chord as a text-search seed.
        const selectedFolderRelativePath =
          document.activeElement instanceof Element
            ? selectedExplorerFolderRelativePath(document.activeElement)
            : null
        if (selectedFolderRelativePath !== null && activeWorktreeId) {
          input.preventDefault()
          notifyTerminalCapture('sidebar.search.toggle')
          actions.showRightSidebarSearch({
            includePattern: folderRelativePathToIncludeGlob(selectedFolderRelativePath)
          })
          return
        }

        const selectedText = getSelectedTextForFileSearch()
        if (selectedText) {
          input.preventDefault()
          notifyTerminalCapture('sidebar.search.toggle')
          openSearchSidebar(selectedText)
          return
        }
      }

      // Why: an empty floating workspace has no tab to close; Cmd/Ctrl+W
      // should hide that transient overlay before underlying app surfaces act.
      if (
        keybindingMatchesAction('tab.close', input, shortcutPlatform, keybindings, {
          context: 'app'
        }) &&
        shouldMinimizeFloatingWorkspacePanelOnCloseShortcut({
          floatingTerminalOpen,
          floatingVisibleTabCount
        })
      ) {
        input.preventDefault()
        setFloatingTerminalOpenWithFocus(false)
        return
      }

      // Why: when the floating workspace is closed, its own keydown handler is
      // unmounted and cannot claim Cmd+Opt+Shift+A. Honor the maximize chord
      // here by opening the panel with a one-shot intent so it mounts straight
      // into the maximized state. While the panel is open, this is a no-op: the
      // panel's handler owns the maximize/restore toggle.
      if (
        !floatingTerminalOpen &&
        matchShortcut('floatingWorkspace.maximize') &&
        floatingTerminalEnabled
      ) {
        input.preventDefault()
        requestFloatingTerminalOpenMaximized()
        setFloatingTerminalOpenWithFocus(true)
        return
      }

      // Why: keep this guard. TipTap's Cmd+B bold binding depends on the
      // window-level handler *not* toggling the sidebar when focus lives in an
      // editable surface. The main-process before-input-event already carves out
      // Cmd+B for the markdown editor (see createMainWindow.ts +
      // docs/markdown-cmd-b-bold-design.md), but this renderer-side fallback
      // still covers the blur→press IPC race and any non-carved editable surface.
      if (isEditableTarget(input.target)) {
        return
      }

      // Why: xterm's helper textarea is intentionally not a generic editable
      // target, but floating-terminal SSH/tmux control chords must still reach
      // the terminal instead of app-level chrome shortcuts.
      if (isFloatingWorkspaceTerminalInputTarget(input.target)) {
        return
      }

      // Cmd/Ctrl+Alt+Arrow — worktree history back/forward. This stays before
      // right-sidebar shortcuts because it is navigation, not sidebar reveal.
      if (matchShortcut('worktree.history.back') || matchShortcut('worktree.history.forward')) {
        // Why: Back/Forward traverse mixed worktree + page visits, so the
        // shortcut is active wherever the titlebar button cluster is (terminal
        // or stack-backed pages). Still suppressed in Settings.
        if (creationLayoutActive || !shouldShowWorktreeHistoryControls(activeView)) {
          return
        }
        input.preventDefault()
        const store = useAppStore.getState()
        if (matchShortcut('worktree.history.back')) {
          store.goBackWorktree()
        } else {
          store.goForwardWorktree()
        }
        return
      }

      // Why: only short-circuit chords the floating panel's own keydown
      // handler claims (Cmd/Ctrl+T, Cmd/Ctrl+W, Cmd/Ctrl+Shift+B/M). Other
      // app-level mod shortcuts (B, L, Shift+E/F/G) have no panel-level
      // counterpart, so suppressing them here would silently no-op when
      // focus lives inside the floating panel.
      const floatingWorkspaceFocused = isFloatingWorkspacePanelFocused()
      if (floatingWorkspaceFocused) {
        if (
          isFloatingWorkspacePanelShortcut(input, shortcutPlatform, null, keybindings, {
            context,
            terminalShortcutPolicy
          })
        ) {
          return
        }
      }

      // Cmd/Ctrl+B — toggle left sidebar
      if (matchShortcut('sidebar.left.toggle')) {
        input.preventDefault()
        notifyTerminalCapture('sidebar.left.toggle')
        actions.toggleSidebar()
        return
      }

      // Toggle the "show sleeping workspaces" sidebar filter without opening the
      // filters menu (issue #5209). When revealing them, open the left sidebar
      // so the now-visible sleeping worktrees are actually reachable.
      if (matchShortcut('sidebar.sleepingWorkspaces.toggle')) {
        input.preventDefault()
        notifyTerminalCapture('sidebar.sleepingWorkspaces.toggle')
        const store = useAppStore.getState()
        const nextShowSleeping = !store.showSleepingWorkspaces
        store.setShowSleepingWorkspaces(nextShowSleeping)
        if (nextShowSleeping) {
          store.setSidebarOpen(true)
        }
        return
      }

      // Why: rename the active terminal tab. Cmd+R is free in the app/terminal
      // focus zone because the browser pane owns its own Cmd+R reload and that
      // focus never reaches this renderer-window handler. Only terminal tabs
      // have an inline title editor, so other active tab types fall through.
      if (workspaceChromeActive && !floatingWorkspaceFocused && matchShortcut('tab.rename')) {
        const store = useAppStore.getState()
        if (store.activeTabType === 'terminal' && store.activeTabId) {
          input.preventDefault()
          notifyTerminalCapture('tab.rename')
          store.setRenamingTabId(store.activeTabId)
          return
        }
      }

      // Why: open the active worktree's inline title editor. Open/reveal it
      // first so the card is mounted and visible even when sidebar filters or
      // collapse state would otherwise hide it.
      if (
        workspaceChromeActive &&
        !floatingWorkspaceFocused &&
        matchShortcut('workspace.rename') &&
        activeWorktreeId
      ) {
        input.preventDefault()
        notifyTerminalCapture('workspace.rename')
        const store = useAppStore.getState()
        store.setSidebarOpen(true)
        requestScrollToCurrentWorkspaceRevealAndRename()
        return
      }

      if (matchShortcut('workspace.openBoard') && activeView !== 'settings') {
        input.preventDefault()
        notifyTerminalCapture('workspace.openBoard')
        const store = useAppStore.getState()
        store.setSidebarOpen(true)
        window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_BOARD_EVENT))
        return
      }

      // Why: Cmd/Ctrl+N is handled via the main-process before-input-event
      // allowlist (see window-shortcut-policy.ts / useIpcEvents.ts) so it works
      // globally — including when focus lives inside the markdown rich editor
      // (contentEditable) or a browser guest webContents, both of which bypass
      // this renderer-side window keydown listener.

      // Why: full-page navigation surfaces should not reveal the right sidebar;
      // they are designed as distraction-free content areas.
      if (matchShortcut('view.tasks') && activeView !== 'settings') {
        const store = useAppStore.getState()
        if (store.repos.some((repo) => isGitRepoKind(repo))) {
          input.preventDefault()
          notifyTerminalCapture('view.tasks')
          store.openTaskPage()
        }
        return
      }

      if (!canRevealRightSidebar) {
        return
      }

      // Cmd/Ctrl+L — toggle right sidebar
      if (matchShortcut('sidebar.right.toggle')) {
        input.preventDefault()
        notifyTerminalCapture('sidebar.right.toggle')
        actions.toggleRightSidebar()
        return
      }

      // Cmd/Ctrl+Shift+E — toggle right sidebar / explorer tab
      if (matchShortcut('sidebar.explorer.toggle')) {
        input.preventDefault()
        notifyTerminalCapture('sidebar.explorer.toggle')
        actions.showRightSidebarFiles()
        return
      }

      // Cmd/Ctrl+Shift+F — toggle right sidebar / search tab
      if (matchShortcut('sidebar.search.toggle')) {
        input.preventDefault()
        notifyTerminalCapture('sidebar.search.toggle')
        openSearchSidebar(null)
        return
      }

      // Cmd/Ctrl+Shift+G — toggle right sidebar / source control tab.
      // Skip when terminal search is open — Cmd+Shift+G means "find previous"
      // in that context (handled by keyboard-handlers.ts). Both listeners share
      // the window capture phase and registration order can vary with React
      // effect re-runs, so a DOM check is the reliable coordination mechanism.
      if (matchShortcut('sidebar.sourceControl.toggle')) {
        if (document.querySelector('[data-terminal-search-root]')) {
          return
        }
        input.preventDefault()
        notifyTerminalCapture('sidebar.sourceControl.toggle')
        actions.setRightSidebarTab('source-control')
        actions.setRightSidebarOpen(true)
        return
      }

      if (matchShortcut('sidebar.checks.toggle')) {
        input.preventDefault()
        notifyTerminalCapture('sidebar.checks.toggle')
        actions.setRightSidebarTab('checks')
        actions.setRightSidebarOpen(true)
        return
      }

      // Cmd+Shift+I — toggle right sidebar / ports tab (macOS only).
      // Why: Ctrl+Shift+I is the built-in DevTools accelerator on Windows/Linux;
      // intercepting it would break an essential developer tool.
      if (matchShortcut('sidebar.ports.toggle')) {
        input.preventDefault()
        notifyTerminalCapture('sidebar.ports.toggle')
        actions.setRightSidebarTab('ports')
        actions.setRightSidebarOpen(true)
      }
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      const detected = doubleTapDetector.process(
        toModifierDoubleTapEvent({
          type: 'keyDown',
          code: e.code,
          key: e.key,
          shift: e.shiftKey,
          control: e.ctrlKey,
          alt: e.altKey,
          meta: e.metaKey,
          isAutoRepeat: e.repeat
        }),
        Date.now()
      )
      if (e.repeat) {
        return
      }
      if (detected) {
        // Synthetic input: no key/modifier flags, so only DoubleTap bindings match.
        dispatchShortcutInput({
          doubleTapModifier: detected.modifier,
          target: e.target,
          defaultPrevented: e.defaultPrevented,
          preventDefault: () => e.preventDefault()
        })
        return
      }
      dispatchShortcutInput({
        key: e.key,
        code: e.code,
        altKey: e.altKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        target: e.target,
        defaultPrevented: e.defaultPrevented,
        preventDefault: () => e.preventDefault()
      })
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      doubleTapDetector.process(
        toModifierDoubleTapEvent({
          type: 'keyUp',
          code: e.code,
          key: e.key,
          shift: e.shiftKey,
          control: e.ctrlKey,
          alt: e.altKey,
          meta: e.metaKey
        }),
        Date.now()
      )
    }

    // Why: a window blur mid-gesture must not leave the detector armed.
    const onBlur = (): void => doubleTapDetector.reset()

    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp, { capture: true })
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}
