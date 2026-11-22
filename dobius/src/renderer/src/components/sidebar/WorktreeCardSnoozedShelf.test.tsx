/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SnoozedTabEntry } from '../../../../shared/tab-snooze-types'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  bringBackSnoozedTab: vi.fn(async () => 'returned'),
  closeSnoozedTabForGood: vi.fn(async () => undefined),
  resnoozeSnoozedTab: vi.fn(async () => undefined),
  toggleSnoozedShelf: vi.fn()
}))

vi.mock('@/store', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
      useSyncExternalStore(
        (listener) => {
          mocks.listeners.add(listener)
          return () => mocks.listeners.delete(listener)
        },
        () => selector(mocks.state)
      )
  }
})

vi.mock('@/lib/tab-snooze/snoozed-tab-actions', () => ({
  bringBackSnoozedTab: mocks.bringBackSnoozedTab,
  closeSnoozedTabForGood: mocks.closeSnoozedTabForGood,
  resnoozeSnoozedTab: mocks.resnoozeSnoozedTab,
  toggleSnoozedShelf: mocks.toggleSnoozedShelf
}))

vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children, open }: { children?: ReactNode; open?: boolean }) =>
    open ? <div data-menu>{children}</div> : null,
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => children,
  DropdownMenuItem: ({ children, onSelect }: { children?: ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => null,
  DropdownMenuShortcut: ({ children }: { children?: ReactNode }) => children,
  DropdownMenuSub: ({ children }: { children?: ReactNode }) => children,
  DropdownMenuSubContent: ({ children }: { children?: ReactNode }) => children,
  DropdownMenuSubTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: () => null
}))

import WorktreeCardSnoozedShelf from './WorktreeCardSnoozedShelf'

function entry(tabId: string, extra: Partial<SnoozedTabEntry> = {}): SnoozedTabEntry {
  return {
    worktreeId: 'wt-1',
    tabId,
    title: tabId,
    snoozedAt: 1,
    until: null,
    ready: false,
    ...extra
  }
}

function setState(patch: Record<string, unknown>): void {
  mocks.state = { ...mocks.state, ...patch }
  act(() => {
    for (const listener of mocks.listeners) {
      listener()
    }
  })
}

let container: HTMLDivElement
let root: Root

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.includes(label)
  )
  if (!found) {
    throw new Error(`Missing button: ${label}`)
  }
  return found
}

beforeEach(() => {
  mocks.state = {
    snoozedTabs: [entry('Fix login'), entry('Other worktree', { worktreeId: 'wt-2' })],
    tabsByWorktree: {},
    snoozedShelfOpenWorktreeIds: []
  }
  for (const mock of [
    mocks.bringBackSnoozedTab,
    mocks.closeSnoozedTabForGood,
    mocks.resnoozeSnoozedTab,
    mocks.toggleSnoozedShelf
  ]) {
    mock.mockClear()
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<WorktreeCardSnoozedShelf worktreeId="wt-1" />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  mocks.listeners.clear()
})

describe('WorktreeCardSnoozedShelf', () => {
  it('is folded by default and shows how many tabs wait under this worktree', () => {
    const header = button('Snoozed')
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(header.textContent).toContain('1')
    expect(container.querySelector('[data-snoozed-tab]')).toBeNull()
    act(() => header.click())
    expect(mocks.toggleSnoozedShelf).toHaveBeenCalledWith('wt-1')
  })

  it('renders nothing for a worktree with no snoozed tabs', () => {
    setState({ snoozedTabs: [] })
    expect(container.innerHTML).toBe('')
  })

  it('unfolded, a row offers Bring back now, Snooze until and Close for good', () => {
    setState({ snoozedShelfOpenWorktreeIds: ['wt-1'] })
    const row = container.querySelector<HTMLButtonElement>('[data-snoozed-tab="Fix login"]')
    expect(row?.textContent).toContain('until you bring it back')
    act(() => row?.click())
    const ref = { worktreeId: 'wt-1', tabId: 'Fix login' }
    act(() => button('Bring back now').click())
    expect(mocks.bringBackSnoozedTab).toHaveBeenCalledWith(ref)
    act(() => button('Until I bring it back').click())
    expect(mocks.resnoozeSnoozedTab).toHaveBeenCalledWith(ref, null)
    act(() => button('Close for good').click())
    expect(mocks.closeSnoozedTabForGood).toHaveBeenCalledWith(ref)
  })
})
