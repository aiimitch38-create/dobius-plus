// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/store', () => ({
  useAppStore: (select: (s: unknown) => unknown) =>
    select({ setContextualToursBlockingSurfaceVisible: () => undefined })
}))

import { ConfirmationDialogProvider, useConfirmationDialog } from './confirmation-dialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let confirm: ReturnType<typeof useConfirmationDialog> | null = null

function Grab(): null {
  confirm = useConfirmationDialog()
  return null
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  confirm = null
})

describe('ConfirmationDialogProvider details', () => {
  it('renders each detail (git command) on its own line in a monospace block', async () => {
    act(() =>
      root.render(
        <ConfirmationDialogProvider>
          <Grab />
        </ConfirmationDialogProvider>
      )
    )
    await act(async () => {
      void confirm?.({
        title: 'Run these git commands?',
        description: 'In /work/wt:',
        details: ['git add -- a.ts', 'git commit -m "fix login"', 'git push']
      })
    })
    const block = document.querySelector('[data-confirmation-details]')
    expect(block?.tagName).toBe('PRE')
    expect([...(block?.children ?? [])].map((line) => line.textContent)).toEqual([
      'git add -- a.ts',
      'git commit -m "fix login"',
      'git push'
    ])
  })
})
