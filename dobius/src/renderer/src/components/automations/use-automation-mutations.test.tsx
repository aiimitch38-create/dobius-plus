// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { AutomationRun } from '../../../../shared/automations-types'
import {
  getAutomationRunNowFailureDetail,
  useAutomationMutations,
  type AutomationMutationRunner
} from './use-automation-mutations'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() }
}))

type HookHandle = {
  pending: ReadonlySet<string>
  run: AutomationMutationRunner
}

let container: HTMLDivElement
let root: Root
let handle: HookHandle

function Harness({ refresh }: { refresh: () => Promise<void> }): null {
  const { pendingAutomationIds, runAutomationMutation } = useAutomationMutations(refresh)
  handle = { pending: pendingAutomationIds, run: runAutomationMutation }
  return null
}

function renderHarness(refresh: () => Promise<void>): void {
  act(() => {
    root.render(<Harness refresh={refresh} />)
  })
}

function makeRun(status: AutomationRun['status'], error: string | null = null): AutomationRun {
  return { id: 'run-1', automationId: 'auto-1', status, error } as AutomationRun
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.mocked(toast.error).mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useAutomationMutations', () => {
  it('shows the rejection, reloads the list and clears pending when a mutation rejects', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderHarness(refresh)
    let reject: (error: Error) => void = () => undefined
    const mutation = (): Promise<void> =>
      new Promise<void>((_resolve, rejectMutation) => {
        reject = rejectMutation
      })

    let settled: Promise<void> = Promise.resolve()
    act(() => {
      settled = handle.run('auto-1', mutation, 'Failed to delete automation.')
    })
    expect(handle.pending.has('auto-1')).toBe(true)

    await act(async () => {
      reject(new Error('Automation not found.'))
      await settled
    })

    expect(toast.error).toHaveBeenCalledWith('Automation not found.')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(handle.pending.has('auto-1')).toBe(false)
  })

  it.each([
    ['Run Now', 'Failed to run automation.'],
    ['Pause', 'Failed to pause automation.'],
    ['Delete', 'Failed to delete automation.']
  ])(
    'uses the %s fallback message when the rejection has none',
    async (_label, fallbackMessage) => {
      renderHarness(vi.fn().mockResolvedValue(undefined))
      await act(async () => {
        const blankError = new Error('placeholder')
        blankError.message = ''
        await handle.run('auto-1', () => Promise.reject(blankError), fallbackMessage)
      })
      expect(toast.error).toHaveBeenCalledWith(fallbackMessage)
      expect(handle.pending.size).toBe(0)
    }
  )

  it('still clears pending and does not reject when the reload after a failure also fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    renderHarness(vi.fn().mockRejectedValue(new Error('host offline')))
    await act(async () => {
      await expect(
        handle.run('auto-1', () => Promise.reject(new Error('boom')), 'fallback')
      ).resolves.toBeUndefined()
    })
    expect(toast.error).toHaveBeenCalledWith('boom')
    expect(handle.pending.size).toBe(0)
    consoleError.mockRestore()
  })

  it('ignores a second action on the same automation while one is pending', async () => {
    renderHarness(vi.fn().mockResolvedValue(undefined))
    let resolveFirst: () => void = () => undefined
    const first = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
    )
    const second = vi.fn().mockResolvedValue(undefined)
    let settled: Promise<void> = Promise.resolve()
    act(() => {
      settled = handle.run('auto-1', first, 'fallback')
    })
    await act(async () => {
      await handle.run('auto-1', second, 'fallback')
    })
    expect(second).not.toHaveBeenCalled()
    await act(async () => {
      resolveFirst()
      await settled
    })
    expect(handle.pending.size).toBe(0)
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('getAutomationRunNowFailureDetail', () => {
  it('treats a started run as queued', () => {
    expect(getAutomationRunNowFailureDetail(makeRun('dispatching'))).toBeNull()
    expect(getAutomationRunNowFailureDetail(makeRun('dispatched'))).toBeNull()
    expect(getAutomationRunNowFailureDetail(makeRun('pending'))).toBeNull()
  })

  it('reports a refused run with its recorded reason', () => {
    expect(
      getAutomationRunNowFailureDetail(
        makeRun('skipped_unavailable', 'Pause crew is on. Agent runs are held.')
      )
    ).toBe('Pause crew is on. Agent runs are held.')
    expect(getAutomationRunNowFailureDetail(makeRun('dispatch_failed'))).toBe('Failed')
    expect(getAutomationRunNowFailureDetail(makeRun('skipped_needs_interactive_auth', ' '))).toBe(
      'Needs credentials'
    )
  })
})
