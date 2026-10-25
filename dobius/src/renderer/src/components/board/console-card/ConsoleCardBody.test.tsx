// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PANE_KEY = 'tab-1:leaf-1'
const storeState = {
  settings: { terminalFontSize: 14 },
  activeWorktreeId: 'other-wt'
}
vi.mock('@/store', () => {
  const useAppStore = (selector: (s: typeof storeState) => unknown) => selector(storeState)
  useAppStore.getState = () => storeState
  return { useAppStore }
})
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({ activateTabAndFocusPane: vi.fn() }))
vi.mock('./use-console-pane', () => ({
  useConsolePane: () => ({ tabExists: true, leafId: 'leaf-1', paneKey: PANE_KEY })
}))
vi.mock('./ConsoleGlance', () => ({
  ConsoleGlanceView: () => <div data-testid="glance" />
}))
const setPortals = vi.fn()
vi.mock('@/components/activity/activity-terminal-portal', () => ({
  setActivityTerminalPortals: (targets: unknown) => setPortals(targets)
}))

const { ConsoleCardBody } = await import('./ConsoleCardBody')
const {
  BOARD_GLANCE_FADE_MS,
  BOARD_PAINT_FALLBACK_MS,
  markBoardTerminalSlotPainted,
  resetBoardTerminalSlotsForTest
} = await import('./board-terminal-slots')
const { CONSOLE_SETTLE_MS } = await import('./console-render-plan')

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const card = {
  id: 'card-1',
  kind: 'console' as const,
  tabId: 'tab-1',
  title: 'Hermes 1',
  agentKind: 'hermes',
  x: 0,
  y: 0,
  w: 400,
  h: 300,
  z: 1
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  resetBoardTerminalSlotsForTest()
  vi.stubGlobal('ResizeObserver', NoopObserver)
  vi.stubGlobal('IntersectionObserver', NoopObserver)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function render(zoom: number): void {
  act(() => {
    root.render(
      <ConsoleCardBody worktreeId="wt" card={card as never} zoom={zoom} focused={false} />
    )
  })
}

const glance = (): HTMLElement | null => container.querySelector('[data-testid="glance"]')
const handoff = (): string | null =>
  container.querySelector('[data-board-glance-handoff]')?.getAttribute('data-board-glance-handoff') ??
  null
const handoffWrapper = (): HTMLElement | null =>
  container.querySelector('[data-board-glance-handoff]')

/** Zoomed out to a glance, then zoomed in and settled: the pane is live but unpainted. */
function zoomInToLive(): void {
  render(0.2)
  expect(glance()).not.toBeNull()
  expect(handoff()).toBeNull()
  render(1)
  act(() => {
    vi.advanceTimersByTime(CONSOLE_SETTLE_MS + 1)
  })
}

describe('ConsoleCardBody glance -> live handoff', () => {
  it('keeps the glance mounted and inert over the live pane until it is painted, then fades it', () => {
    zoomInToLive()
    expect(handoff()).toBe('waiting')
    expect(glance()).not.toBeNull()
    expect(handoffWrapper()?.style.pointerEvents).toBe('none')
    expect(handoffWrapper()?.style.opacity).toBe('1')
    // The live pane was claimed under the glance.
    expect(setPortals).toHaveBeenCalled()

    act(() => {
      markBoardTerminalSlotPainted(PANE_KEY)
    })
    expect(handoff()).toBe('fading')
    expect(handoffWrapper()?.style.opacity).toBe('0')

    act(() => {
      vi.advanceTimersByTime(BOARD_GLANCE_FADE_MS - 1)
    })
    expect(glance()).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(glance()).toBeNull()
    expect(handoff()).toBeNull()
  })

  it('falls back to revealing the pane after 350 ms when no paint is reported', () => {
    zoomInToLive()
    act(() => {
      vi.advanceTimersByTime(BOARD_PAINT_FALLBACK_MS - 1)
    })
    expect(handoff()).toBe('waiting')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(handoff()).toBe('fading')
    act(() => {
      vi.advanceTimersByTime(BOARD_GLANCE_FADE_MS)
    })
    expect(glance()).toBeNull()
  })

  it('ignores a paint for another pane', () => {
    zoomInToLive()
    act(() => {
      markBoardTerminalSlotPainted('tab-9:leaf-9')
    })
    expect(handoff()).toBe('waiting')
  })

  it('zooming back out during the wait returns to a plain glance', () => {
    zoomInToLive()
    render(0.2)
    act(() => {
      vi.advanceTimersByTime(CONSOLE_SETTLE_MS + 1)
    })
    expect(handoff()).toBeNull()
    expect(glance()).not.toBeNull()
    expect(handoffWrapper()).toBeNull()
  })

  it('a card that starts live has no glance to hand off from', () => {
    render(1)
    expect(glance()).toBeNull()
    expect(handoff()).toBeNull()
  })
})
