// @vitest-environment happy-dom
import { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardStudioId } from '../board-studios/board-studio-ids'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { stub } = vi.hoisted(() => ({
  stub: (name: string) => () => <div data-home-stub={name}>{`stub:${name}`}</div>
}))

// Why: the test proves Home mounts the studio host from the store slot and
// closes back to Home; the Home widgets and the hosted pages are not under test.
vi.mock('./HomeTopPills', () => ({ HomeTopPills: stub('HomeTopPills'), homeStatusText: () => '' }))
vi.mock('./HomeLauncherBar', () => ({ HomeLauncherBar: stub('HomeLauncherBar') }))
vi.mock('./HomeRepoList', () => ({ HomeRepoList: stub('HomeRepoList') }))
vi.mock('@/components/dictation/VoiceOrb', () => ({ VoiceOrb: stub('VoiceOrb') }))
vi.mock('@/components/dictation/voice-orb-live-level', () => ({
  voiceOrbLevelSource: { current: () => 0 }
}))
vi.mock('@/components/confirmation-dialog', () => ({
  useConfirmationDialog: () => async () => false
}))
vi.mock('@/components/sidebar/WorktreeOpenInMenu', () => ({ openWorktreePath: vi.fn() }))
vi.mock('../board-presets/board-preset-store', () => ({
  listBoardPresets: async () => []
}))
vi.mock('../board-presets/preset-catalog', () => ({ presetCatalog: () => [] }))
vi.mock('../board-studios/BoardStudioHost', () => ({
  BoardStudioHost: ({
    studio,
    worktreeId,
    onClose
  }: {
    studio: BoardStudioId | null
    worktreeId: string | null
    onClose: () => void
  }) =>
    studio ? (
      <div data-studio-host={studio} data-worktree={String(worktreeId)}>
        {`host:${studio}`}
        <button type="button" onClick={onClose}>
          close-studio
        </button>
      </div>
    ) : null
}))

const storeMock = vi.hoisted(() => ({ store: null as null | import('zustand').StoreApi<any> }))
vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  const useAppStore = create<Record<string, unknown>>((set) => ({
    activeView: 'home',
    activeWorktreeId: null,
    activeRepoId: null,
    repos: [],
    worktreesByRepo: {},
    boardsByWorktree: {},
    tabsByWorktree: {},
    agentStatusByPaneKey: {},
    acknowledgedAgentsByPaneKey: {},
    agentStatusEpoch: 0,
    settings: null,
    activeModal: 'none',
    boardStudio: null,
    setBoardStudio: (studio: BoardStudioId | null) => set({ boardStudio: studio }),
    openModal: vi.fn(),
    addRepo: async () => null,
    removeProject: async () => undefined
  }))
  storeMock.store = useAppStore
  return { useAppStore }
})

vi.stubEnv('VITE_DOBIUS_APP_VERSION', '0.0.0-test')

import BoardHome from './BoardHome'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  storeMock.store!.setState({ boardStudio: null })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderHome(): void {
  act(() =>
    root.render(
      <Suspense fallback={null}>
        <BoardHome />
      </Suspense>
    )
  )
}

describe('BoardHome studio host', () => {
  it('renders Home with no studio host until one is opened', () => {
    renderHome()
    expect(container.textContent).toContain('stub:HomeLauncherBar')
    expect(container.querySelector('[data-studio-host]')).toBeNull()
  })

  it.each(['automations', 'settings'] as BoardStudioId[])(
    'hosts the %s studio over Home with no workspace',
    (studio) => {
      renderHome()
      act(() => storeMock.store!.getState().setBoardStudio(studio))
      const host = container.querySelector('[data-studio-host]')
      expect(host?.getAttribute('data-studio-host')).toBe(studio)
      expect(host?.getAttribute('data-worktree')).toBe('null')
      // Home stays mounted underneath.
      expect(container.textContent).toContain('stub:HomeLauncherBar')
    }
  )

  it('closing the studio returns to Home', () => {
    renderHome()
    act(() => storeMock.store!.getState().setBoardStudio('settings'))
    const close = container.querySelector('button')
    expect(close?.textContent).toBe('close-studio')
    act(() => close!.click())
    expect(storeMock.store!.getState().boardStudio).toBeNull()
    expect(container.querySelector('[data-studio-host]')).toBeNull()
    expect(container.textContent).toContain('stub:HomeLauncherBar')
  })

  it('clears the open studio when Home unmounts', () => {
    renderHome()
    act(() => storeMock.store!.getState().setBoardStudio('automations'))
    act(() => root.unmount())
    expect(storeMock.store!.getState().boardStudio).toBeNull()
    // afterEach unmounts again; a second unmount of a fresh root is a no-op.
    root = createRoot(container)
  })
})
