// Backs update_tray_agent_activity / clear_tray_agent_activity.
//
// Real Electron API: Tray + Menu.buildFromTemplate. This is a SEPARATE tray
// icon from Dobius's own app-level tray (src/main/tray/system-tray.ts, which
// is Windows-only and only offers Open/Quit) — Buzz's is a macOS-style
// menu-bar indicator for "which agents are actively working", cross-platform
// by Electron's Tray API but most useful on macOS. See RISKS in the build
// report: running both trays at once may be unwanted on Windows, where
// Dobius already shows one tray icon.
//
// Menu clicks enqueue into the shared TrayActionQueue (tray-action-queue.ts)
// so take_tray_actions/requeue_tray_actions can hand them to the renderer.

import type { TrayAction, TrayActionQueue } from './tray-action-queue'

export type TrayAgentActivity = {
  activityId: string
  agentName: string
  channelId: string
  channelName: string
  elapsed: string
}

export type TrayMenuItem = {
  label: string
  enabled?: boolean
  click?: () => void
  type?: 'separator'
}

export type TrayHandle = {
  isDestroyed: () => boolean
  setToolTip: (text: string) => void
  setContextMenu: (menu: unknown) => void
  destroy: () => void
}

export type AgentActivityTrayDeps = {
  getOrCreateTray: () => TrayHandle | null
  buildMenuFromTemplate: (template: TrayMenuItem[]) => unknown
  actionQueue: TrayActionQueue
  // Why: after enqueueing, the renderer needs to learn a new action exists.
  // Kept as an injectable no-arg hook rather than assuming any particular
  // event-emission mechanism — see the build report for the current gap
  // (the vendor listener for this uses a Tauri-only event channel today).
  notifyActionAvailable: () => void
}

const MAX_RECENT_ITEMS_SHOWN = 5

function activityMenuItems(
  activities: TrayAgentActivity[],
  deps: AgentActivityTrayDeps
): TrayMenuItem[] {
  return activities.map((activity) => ({
    label: `${activity.agentName} — #${activity.channelName} (${activity.elapsed})`,
    click: () => {
      deps.actionQueue.enqueue({ kind: 'openChannel', channelId: activity.channelId })
      deps.notifyActionAvailable()
    }
  }))
}

function recentMenuItems(
  recentActivities: TrayAgentActivity[],
  deps: AgentActivityTrayDeps
): TrayMenuItem[] {
  return recentActivities.slice(0, MAX_RECENT_ITEMS_SHOWN).map((activity) => ({
    label: `Recent: ${activity.agentName} — #${activity.channelName}`,
    click: () => {
      deps.actionQueue.enqueue({ kind: 'openChannel', channelId: activity.channelId })
      deps.notifyActionAvailable()
    }
  }))
}

function newChannelMenuItem(deps: AgentActivityTrayDeps): TrayMenuItem {
  return {
    label: 'New channel…',
    click: () => {
      const action: TrayAction = { kind: 'newChannel' }
      deps.actionQueue.enqueue(action)
      deps.notifyActionAvailable()
    }
  }
}

export type UpdateTrayAgentActivityParams = {
  activities: TrayAgentActivity[]
  recentActivities: TrayAgentActivity[]
}

export type AgentActivityTrayResult =
  | { updated: true }
  | { updated: false; reason: 'no_tray_available' }

export function updateTrayAgentActivity(
  params: UpdateTrayAgentActivityParams,
  deps: AgentActivityTrayDeps
): AgentActivityTrayResult {
  const tray = deps.getOrCreateTray()
  if (!tray || tray.isDestroyed()) {
    return { updated: false, reason: 'no_tray_available' }
  }

  const template: TrayMenuItem[] = [
    newChannelMenuItem(deps),
    { label: '', type: 'separator' },
    ...(params.activities.length > 0
      ? activityMenuItems(params.activities, deps)
      : [{ label: 'No agents currently active', enabled: false }])
  ]

  if (params.recentActivities.length > 0) {
    template.push(
      { label: '', type: 'separator' },
      ...recentMenuItems(params.recentActivities, deps)
    )
  }

  tray.setToolTip(
    params.activities.length > 0
      ? `${params.activities.length} agent(s) active`
      : 'Dobius Communications'
  )
  tray.setContextMenu(deps.buildMenuFromTemplate(template))
  return { updated: true }
}

export function clearTrayAgentActivity(deps: AgentActivityTrayDeps): AgentActivityTrayResult {
  const tray = deps.getOrCreateTray()
  if (!tray || tray.isDestroyed()) {
    return { updated: false, reason: 'no_tray_available' }
  }

  tray.setToolTip('Dobius Communications')
  tray.setContextMenu(deps.buildMenuFromTemplate([newChannelMenuItem(deps)]))
  return { updated: true }
}
