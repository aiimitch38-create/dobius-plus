import { describe, expect, it, vi } from 'vitest'
import { createTrayActionQueue } from './tray-action-queue'
import {
  clearTrayAgentActivity,
  updateTrayAgentActivity,
  type AgentActivityTrayDeps,
  type TrayHandle,
  type TrayMenuItem
} from './agent-activity-tray'

function fakeTray(destroyed = false): TrayHandle {
  return {
    isDestroyed: () => destroyed,
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    destroy: vi.fn()
  }
}

function makeDeps(overrides: Partial<AgentActivityTrayDeps> = {}): AgentActivityTrayDeps {
  const tray = fakeTray()
  return {
    getOrCreateTray: () => tray,
    buildMenuFromTemplate: (template) => template,
    actionQueue: createTrayActionQueue(),
    notifyActionAvailable: vi.fn(),
    ...overrides
  }
}

describe('updateTrayAgentActivity', () => {
  it('reports no_tray_available instead of throwing when there is no tray', () => {
    const result = updateTrayAgentActivity(
      { activities: [], recentActivities: [] },
      makeDeps({ getOrCreateTray: () => null })
    )
    expect(result).toEqual({ updated: false, reason: 'no_tray_available' })
  })

  it('shows a placeholder item when nothing is active', () => {
    const tray = fakeTray()
    const deps = makeDeps({ getOrCreateTray: () => tray })
    updateTrayAgentActivity({ activities: [], recentActivities: [] }, deps)
    const template = (tray.setContextMenu as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as TrayMenuItem[]
    expect(template.some((item) => item.label === 'No agents currently active')).toBe(true)
    expect(tray.setToolTip).toHaveBeenCalledWith('Dobius Communications')
  })

  it('lists active agents and sets an activity-count tooltip', () => {
    const tray = fakeTray()
    const deps = makeDeps({ getOrCreateTray: () => tray })
    updateTrayAgentActivity(
      {
        activities: [
          {
            activityId: 'a1',
            agentName: 'Codex',
            channelId: 'chan-1',
            channelName: 'general',
            elapsed: '2m'
          }
        ],
        recentActivities: []
      },
      deps
    )
    expect(tray.setToolTip).toHaveBeenCalledWith('1 agent(s) active')
    const template = (tray.setContextMenu as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as TrayMenuItem[]
    expect(template.some((item) => item.label.includes('Codex'))).toBe(true)
  })

  it('clicking an activity item enqueues an openChannel action and notifies', () => {
    const tray = fakeTray()
    const deps = makeDeps({ getOrCreateTray: () => tray })
    updateTrayAgentActivity(
      {
        activities: [
          {
            activityId: 'a1',
            agentName: 'Codex',
            channelId: 'chan-1',
            channelName: 'general',
            elapsed: '2m'
          }
        ],
        recentActivities: []
      },
      deps
    )
    const template = (tray.setContextMenu as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as TrayMenuItem[]
    const activityItem = template.find((item) => item.label.includes('Codex'))
    activityItem?.click?.()
    expect(deps.actionQueue.takeAll()).toEqual([{ kind: 'openChannel', channelId: 'chan-1' }])
    expect(deps.notifyActionAvailable).toHaveBeenCalledOnce()
  })

  it('clicking "New channel…" enqueues a newChannel action', () => {
    const tray = fakeTray()
    const deps = makeDeps({ getOrCreateTray: () => tray })
    updateTrayAgentActivity({ activities: [], recentActivities: [] }, deps)
    const template = (tray.setContextMenu as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as TrayMenuItem[]
    const newChannelItem = template.find((item) => item.label === 'New channel…')
    newChannelItem?.click?.()
    expect(deps.actionQueue.takeAll()).toEqual([{ kind: 'newChannel' }])
  })
})

describe('clearTrayAgentActivity', () => {
  it('reports no_tray_available instead of throwing when there is no tray', () => {
    const result = clearTrayAgentActivity(makeDeps({ getOrCreateTray: () => null }))
    expect(result).toEqual({ updated: false, reason: 'no_tray_available' })
  })

  it('resets the menu down to just New channel…', () => {
    const tray = fakeTray()
    const deps = makeDeps({ getOrCreateTray: () => tray })
    clearTrayAgentActivity(deps)
    expect(tray.setContextMenu).toHaveBeenCalledWith([
      expect.objectContaining({ label: 'New channel…' })
    ])
    expect(tray.setToolTip).toHaveBeenCalledWith('Dobius Communications')
  })
})
