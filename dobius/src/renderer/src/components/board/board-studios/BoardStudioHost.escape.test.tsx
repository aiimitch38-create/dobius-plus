// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./board-studio-lazy-pages', () => ({}))
vi.mock('./ChatStudio', () => ({ ChatStudio: () => null }))
vi.mock('./MemoryStudio', () => ({ MemoryStudio: () => null }))
vi.mock('./MissionMapStudio', () => ({ MissionMapStudio: () => null }))
vi.mock('./RepoDocumentsStudio', () => ({ RepoDocumentsStudio: () => null }))
vi.mock('./LoopsStudio', () => ({ LoopsStudio: () => null }))
vi.mock('./SettingsStudio', () => ({ SettingsStudio: () => null }))
vi.mock('./SkillsStudio', () => ({ SkillsStudio: () => null }))
vi.mock('../board-presets/PresetsStudio', () => ({ PresetsStudio: () => null }))
vi.mock('@/store/selectors', () => ({ useRepoById: () => null, useWorktreesForRepo: () => [] }))
vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  return { useAppStore: create<Record<string, unknown>>(() => ({ rightSidebarTab: 'explorer' })) }
})
// Stands in for the code browser: a field, plus Monaco's find widget, which is
// a hidden role="dialog" left in the editor once Find has been used.
vi.mock('./CodeStudio', () => ({
  CodeStudio: () => (
    <div>
      <textarea data-editor-input />
      <div className="find-widget" role="dialog" aria-hidden="true" data-find-widget />
    </div>
  )
}))

import { BoardStudioHost } from './BoardStudioHost'

let container: HTMLDivElement
let root: Root
const onClose = vi.fn()
beforeEach(() => {
  onClose.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root.render(
      <TooltipProvider>
        <BoardStudioHost
          studio="code"
          worktreeId="wt-1"
          onClose={onClose}
          freeCenter={() => ({ x: 0, y: 0 })}
        />
      </TooltipProvider>
    )
  )
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const pressEscape = (target: EventTarget): void => {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
  })
}

describe('Browse code studio Escape', () => {
  it('closes from inside the editor even after Find left its hidden dialog behind', () => {
    const input = document.querySelector<HTMLTextAreaElement>('[data-editor-input]')!
    expect(input).not.toBeNull()
    pressEscape(input)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('closes without the find widget', () => {
    document.querySelector('[data-find-widget]')!.remove()
    pressEscape(document.querySelector<HTMLTextAreaElement>('[data-editor-input]')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
