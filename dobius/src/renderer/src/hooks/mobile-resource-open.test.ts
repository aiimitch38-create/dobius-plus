import { createStore } from 'zustand/vanilla'
import { describe, expect, it, vi } from 'vitest'
import { createEditorSlice } from '../store/slices/editor'
import { createTabsSlice } from '../store/slices/tabs'
import type { AppState } from '../store/types'
import { openMobileResourceInStore } from './mobile-resource-open'
import type { RuntimeFileOpenOptions } from '../../../shared/runtime-files'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

async function setup() {
  // This Node boundary test loads the host dynamically so renderer typechecks
  // keep main-process dependencies out of their production project graph.
  const commandPath = '../../../main/runtime/dobius-runtime-files'
  const dispatchPath = '../../../main/runtime/rpc/dispatcher'
  const methodPath = '../../../main/runtime/rpc/methods/files'
  const { RuntimeFileCommands } = await import(commandPath)
  const { RpcDispatcher } = await import(dispatchPath)
  const { FILE_METHODS } = await import(methodPath)
  const store = createStore<AppState>()(
    (...args) =>
      ({
        activeWorktreeId: 'desktop',
        activeView: 'terminal',
        tabsByWorktree: {},
        browserTabsByWorktree: {},
        activeBrowserTabId: null,
        activeBrowserTabIdByWorktree: {},
        settings: { activeRuntimeEnvironmentId: 'unrelated-desktop-runtime' },
        recordFeatureInteraction: vi.fn(),
        ...createTabsSlice(...args),
        ...createEditorSlice(...args),
        setActiveWorktree: vi.fn((id) => args[0]({ activeWorktreeId: id })),
        setActiveView: vi.fn((view) => args[0]({ activeView: view })),
        markWorktreeVisited: vi.fn(),
        revealWorktreeInSidebar: vi.fn()
      }) as unknown as AppState
  )
  store.getState().createUnifiedTab('desktop', 'terminal', { id: 'typing', entityId: 'typing' })
  store
    .getState()
    .createUnifiedTab('phone', 'terminal', { id: 'phone-terminal', entityId: 'phone-terminal' })
  store.setState({
    activeTabType: 'terminal',
    activeTabId: 'typing',
    activeTabIdByWorktree: { desktop: 'typing', phone: 'phone-terminal' }
  })
  const commands = new RuntimeFileCommands({
    resolveRuntimeFileTarget: async (selector: string) => ({
      worktree: { id: selector.slice(3), repoId: 'repo', path: '/srv/workspace' },
      connectionId: 'ssh-phone'
    }),
    openFile: (
      worktreeId: string,
      filePath: string,
      relativePath: string,
      runtimeEnvironmentId?: string | null,
      options?: RuntimeFileOpenOptions
    ) =>
      openMobileResourceInStore(store.getState(), {
        worktreeId,
        filePath,
        relativePath,
        runtimeEnvironmentId,
        ...options
      }),
    openDiff: (
      worktreeId: string,
      filePath: string,
      relativePath: string,
      staged: boolean,
      runtimeEnvironmentId?: string | null,
      options?: RuntimeFileOpenOptions
    ) =>
      openMobileResourceInStore(store.getState(), {
        worktreeId,
        filePath,
        relativePath,
        staged,
        runtimeEnvironmentId,
        ...options
      })
  })
  const runtime = {
    getRuntimeId: () => 'host',
    openMobileFile: commands.openMobileFile.bind(commands),
    openMobileDiff: commands.openMobileDiff.bind(commands)
  }
  return { store, dispatcher: new RpcDispatcher({ runtime, methods: FILE_METHODS }) }
}

function selection(s: AppState) {
  return {
    worktree: s.activeWorktreeId,
    view: s.activeView,
    tab: s.activeTabId,
    type: s.activeTabType,
    file: s.activeFileId,
    browser: s.activeBrowserTabId,
    tabs: s.activeTabIdByWorktree,
    files: s.activeFileIdByWorktree,
    types: s.activeTabTypeByWorktree,
    groups: s.activeGroupIdByWorktree,
    groupSelection: Object.fromEntries(
      Object.entries(s.groupsByWorktree).map(([id, groups]) => [
        id,
        groups.map((g) => ({ id: g.id, selected: g.activeTabId, recent: g.recentTabIds }))
      ])
    ),
    runtime: s.settings?.activeRuntimeEnvironmentId
  }
}

describe('background resource RPC to renderer store', () => {
  it.each([
    ['files.openBackground', 'desktop'],
    ['files.openBackground', 'phone'],
    ['files.openDiffBackground', 'desktop'],
    ['files.openDiffBackground', 'phone']
  ])(
    '%s in %s publishes a usable tab without changing desktop selection',
    async (method, target) => {
      const { store, dispatcher } = await setup()
      const before = structuredClone(selection(store.getState()))
      const request = {
        id: 'open',
        authToken: 'test',
        method,
        params: { worktree: `id:${target}`, relativePath: 'notes/note.md', staged: true }
      }
      expect(await dispatcher.dispatch(request)).toMatchObject({
        ok: true,
        result: { opened: true }
      })
      const file = store.getState().openFiles.find((f) => f.worktreeId === target)!
      expect(file).toMatchObject({
        filePath: '/srv/workspace/notes/note.md',
        language: 'markdown',
        runtimeEnvironmentId: null,
        mode: method.includes('Diff') ? 'diff' : 'edit'
      })
      if (method.includes('Diff')) {
        expect(file.diffSource).toBe('staged')
      }
      expect(
        store.getState().unifiedTabsByWorktree[target]?.some((t) => t.entityId === file.id)
      ).toBe(true)
      expect(selection(store.getState())).toEqual(before)
      // A later user selection must survive repeated/reused resource delivery too.
      store.setState({ activeView: 'tasks' })
      const later = structuredClone(selection(store.getState()))
      expect(await dispatcher.dispatch(request)).toMatchObject({ ok: true })
      expect(selection(store.getState())).toEqual(later)
      expect(store.getState().setActiveWorktree).not.toHaveBeenCalled()
      expect(store.getState().revealWorktreeInSidebar).not.toHaveBeenCalled()
    }
  )

  it.each(['files.open', 'files.openDiff'])(
    '%s retains foreground desktop selection',
    async (method) => {
      const { store, dispatcher } = await setup()
      expect(
        await dispatcher.dispatch({
          id: 'open',
          authToken: 'test',
          method,
          params: { worktree: 'id:phone', relativePath: 'note.md', staged: false }
        })
      ).toMatchObject({ ok: true })
      expect(store.getState()).toMatchObject({ activeWorktreeId: 'phone', activeTabType: 'editor' })
      expect(store.getState().activeFileId).toBe(store.getState().openFiles[0]?.id)
      expect(store.getState().revealWorktreeInSidebar).toHaveBeenCalledWith('phone')
    }
  )

  it.each([
    '../private.md',
    'notes/../../private.md',
    'notes\\..\\private.md',
    '/etc/passwd',
    'C:\\secret.md'
  ])('refuses SSH path escape %s before publishing a tab', async (relativePath) => {
    const { store, dispatcher } = await setup()
    const before = structuredClone(selection(store.getState()))
    for (const method of ['files.openBackground', 'files.openDiffBackground']) {
      expect(
        await dispatcher.dispatch({
          id: 'escape',
          authToken: 'test',
          method,
          params: { worktree: 'id:phone', relativePath }
        })
      ).toMatchObject({ ok: false })
    }
    expect(store.getState().openFiles).toEqual([])
    expect(selection(store.getState())).toEqual(before)
  })
})
