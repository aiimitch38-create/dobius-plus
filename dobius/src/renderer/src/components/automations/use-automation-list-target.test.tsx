// @vitest-environment happy-dom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { AutomationHostTarget } from './automation-host-client'
import { useAutomationListTarget } from './use-automation-list-target'

type TestSettings = { theme: string; activeRuntimeEnvironmentId?: string | null }

const testStore = create<{ settings: TestSettings | null }>(() => ({
  settings: { theme: 'dark', activeRuntimeEnvironmentId: null }
}))

vi.mock('@/store', () => ({
  useAppStore: <T,>(selector: (state: { settings: TestSettings | null }) => T): T =>
    testStore(selector)
}))

let container: HTMLDivElement
let root: Root

// Mirrors the page's load effect: it reloads whenever the list target changes.
function LoadHarness({ load }: { load: (target: AutomationHostTarget) => void }): null {
  const target = useAutomationListTarget()
  useEffect(() => {
    load(target)
  }, [load, target])
  return null
}

function setSettings(settings: TestSettings): void {
  act(() => {
    testStore.setState({ settings })
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  testStore.setState({ settings: { theme: 'dark', activeRuntimeEnvironmentId: null } })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useAutomationListTarget', () => {
  it('does not reload automations when an unrelated setting such as the theme changes', () => {
    const load = vi.fn()
    act(() => {
      root.render(<LoadHarness load={load} />)
    })
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenLastCalledWith({ kind: 'local' })

    setSettings({ theme: 'light', activeRuntimeEnvironmentId: null })
    setSettings({ theme: 'system', activeRuntimeEnvironmentId: null })

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('reloads when the active runtime environment changes', () => {
    const load = vi.fn()
    act(() => {
      root.render(<LoadHarness load={load} />)
    })

    setSettings({ theme: 'dark', activeRuntimeEnvironmentId: 'env-1' })
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith({ kind: 'environment', environmentId: 'env-1' })

    setSettings({ theme: 'light', activeRuntimeEnvironmentId: 'env-1' })
    expect(load).toHaveBeenCalledTimes(2)
  })
})
