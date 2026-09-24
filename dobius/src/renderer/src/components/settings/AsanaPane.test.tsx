// @vitest-environment happy-dom

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentsExecutionState } from '../../../../shared/agents'
import type { AsanaConfig } from '../../../../shared/asana'
import { AsanaPane } from './AsanaPane'

// Why: these tests cover the Auto Mode row only; Radix Select and the app store are not under test.
vi.mock('../ui/select', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }): React.JSX.Element => (
    <>{children}</>
  )
  return {
    Select: Passthrough,
    SelectContent: Passthrough,
    SelectItem: Passthrough,
    SelectTrigger: Passthrough,
    SelectValue: Passthrough
  }
})

vi.mock('../../store', () => {
  const state = { settings: { disabledTuiAgents: [] }, settingsSearchQuery: '' }
  return { useAppStore: (selector: (value: typeof state) => unknown) => selector(state) }
})

let container: HTMLDivElement
let root: Root

function asanaConfig(enabled: boolean): AsanaConfig {
  return {
    myGid: '',
    reviewGid: '',
    autoMode: { enabled, intervalMinutes: 10, buildAgent: 'claude' }
  } as unknown as AsanaConfig
}

function executionState(overrides: Partial<AgentsExecutionState>): AgentsExecutionState {
  return {
    paused: false,
    status: 'ok',
    detail: null,
    filePath: '/data/agents-config.json',
    ...overrides
  }
}

async function renderPane(autoModeEnabled: boolean, state: AgentsExecutionState): Promise<void> {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      asana: {
        getConfig: vi.fn().mockResolvedValue(asanaConfig(autoModeEnabled)),
        hasToken: vi.fn().mockResolvedValue(true)
      },
      agents: {
        list: vi.fn().mockResolvedValue([]),
        getExecutionState: vi.fn().mockResolvedValue(state)
      }
    }
  })
  await act(async () => {
    root.render(<AsanaPane />)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AsanaPane Auto Mode execution state', () => {
  it('says Auto Mode is blocked when it is enabled but the crew is paused', async () => {
    await renderPane(true, executionState({ paused: true }))
    expect(container.textContent).toContain('Blocked: crew paused')
  })

  it('shows the unreadable control file path when Auto Mode is enabled', async () => {
    await renderPane(
      true,
      executionState({ paused: true, status: 'unreadable', detail: 'invalid JSON' })
    )
    expect(container.textContent).toContain('crew control file could not be read')
    expect(container.textContent).toContain('/data/agents-config.json')
  })

  it('shows no blocked note when the crew is running', async () => {
    await renderPane(true, executionState({}))
    expect(container.textContent).not.toContain('Blocked')
  })

  it('shows no blocked note when Auto Mode is off', async () => {
    await renderPane(false, executionState({ paused: true }))
    expect(container.textContent).not.toContain('Blocked')
  })
})
