// @vitest-environment happy-dom
import { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardStudioId } from './board-studio-ids'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { stub } = vi.hoisted(() => ({
  stub: (name: string) => () => <div data-studio-stub={name}>{`stub:${name}`}</div>
}))

// Why: the hosted pages are the heaviest modules in the app; the test proves
// the studio wiring renders each one, not the pages themselves.
vi.mock('./board-studio-lazy-pages', () => ({
  SkillsPage: stub('SkillsPage'),
  Settings: stub('Settings'),
  AutomationsPage: stub('AutomationsPage'),
  NativeChatView: stub('NativeChatView'),
  FileExplorer: stub('FileExplorer'),
  EditorPanel: stub('EditorPanel'),
  AgentsPage: stub('AgentsPage'),
  BuzzPage: stub('BuzzPage'),
  KanbanPage: stub('KanbanPage'),
  SourceControl: stub('SourceControl'),
  ChecksPanel: stub('ChecksPanel'),
  FolderWorkspacePrChecksPanel: stub('FolderWorkspacePrChecksPanel'),
  PortsPanel: stub('PortsPanel'),
  PromptsPanel: stub('PromptsPanel'),
  AiVaultPanel: stub('AiVaultPanel'),
  AsanaTasksPanel: stub('AsanaTasksPanel'),
  TaskPage: stub('TaskPage'),
  MobilePage: stub('MobilePage')
}))
vi.mock('./ChatStudio', () => ({ ChatStudio: stub('ChatStudio') }))
vi.mock('./CodeStudio', () => ({ CodeStudio: stub('CodeStudio') }))
vi.mock('./MemoryStudio', () => ({ MemoryStudio: stub('MemoryStudio') }))
vi.mock('./MissionMapStudio', () => ({ MissionMapStudio: stub('MissionMapStudio') }))
vi.mock('./RepoDocumentsStudio', () => ({ RepoDocumentsStudio: stub('RepoDocumentsStudio') }))
vi.mock('./LoopsStudio', () => ({ LoopsStudio: stub('LoopsStudio') }))
vi.mock('./SettingsStudio', () => ({ SettingsStudio: stub('SettingsStudio') }))
vi.mock('./SkillsStudio', () => ({ SkillsStudio: stub('SkillsStudio') }))
vi.mock('../board-presets/PresetsStudio', () => ({ PresetsStudio: stub('PresetsStudio') }))
vi.mock('@/store/selectors', () => ({ useRepoById: () => null }))

const storeMock = vi.hoisted(() => ({ store: null as null | import('zustand').StoreApi<any> }))
vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  const useAppStore = create<Record<string, unknown>>((set) => ({
    boardStudio: 'source-control',
    setBoardStudio: (studio: BoardStudioId | null) => set({ boardStudio: studio }),
    rightSidebarTab: 'explorer',
    getKnownWorktreeById: () => undefined,
    closeTaskPage: () => set({ closed: 'classic' }),
    closeAutomationsPage: () => set({ closed: 'classic' }),
    closeMobilePage: () => set({ closed: 'classic' })
  }))
  storeMock.store = useAppStore
  return { useAppStore }
})

import { StudioBody } from './BoardStudioHost'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const freeCenter = () => ({ x: 0, y: 0 })

function renderStudio(studio: BoardStudioId, onClose = vi.fn()): void {
  act(() =>
    root.render(
      <Suspense fallback={null}>
        <StudioBody
          studio={studio}
          worktreeId="wt-1"
          chatTabId={null}
          freeCenter={freeCenter}
          onClose={onClose}
        />
      </Suspense>
    )
  )
}

const HOSTED: Array<[BoardStudioId, string]> = [
  ['source-control', 'SourceControl'],
  ['checks', 'ChecksPanel'],
  ['ports', 'PortsPanel'],
  ['prompts', 'PromptsPanel'],
  ['vault', 'AiVaultPanel'],
  ['asana-tasks', 'AsanaTasksPanel'],
  ['automations', 'AutomationsPage'],
  ['tasks-page', 'TaskPage'],
  ['mobile', 'MobilePage']
]

describe('StudioBody hosted studios', () => {
  it.each(HOSTED)('%s renders the existing %s', (studio, child) => {
    renderStudio(studio)
    expect(container.textContent).toContain(`stub:${child}`)
  })

  it('source control and checks show an empty state without a workspace', () => {
    act(() =>
      root.render(
        <Suspense fallback={null}>
          <StudioBody
            studio="source-control"
            worktreeId={null}
            chatTabId={null}
            freeCenter={freeCenter}
            onClose={() => {}}
          />
        </Suspense>
      )
    )
    expect(container.textContent).toContain('Open a workspace')
    expect(container.textContent).not.toContain('stub:')
  })

  it.each([
    ['automations', 'AutomationsPage'],
    ['settings', 'SettingsStudio'],
    ['tasks-page', 'TaskPage'],
    ['mobile', 'MobilePage'],
    ['skills', 'SkillsStudio']
  ] as Array<[BoardStudioId, string]>)(
    '%s renders without a workspace (opened from Home)',
    (studio, child) => {
      act(() =>
        root.render(
          <Suspense fallback={null}>
            <StudioBody
              studio={studio}
              worktreeId={null}
              chatTabId={null}
              freeCenter={freeCenter}
              onClose={() => {}}
            />
          </Suspense>
        )
      )
      expect(container.textContent).toContain(`stub:${child}`)
    }
  )

  it('a hosted panel navigating the sidebar tab switches the studio', () => {
    renderStudio('source-control')
    act(() => storeMock.store!.setState({ rightSidebarTab: 'checks' }))
    expect(storeMock.store!.getState().boardStudio).toBe('checks')
  })

  it("a hosted Classic page's own close action closes the studio instead", () => {
    const onClose = vi.fn()
    renderStudio('tasks-page', onClose)
    act(() => {
      ;(storeMock.store!.getState().closeTaskPage as () => void)()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(storeMock.store!.getState().closed).toBeUndefined()
  })
})
