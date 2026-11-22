import { BrowserWindow, ipcMain, powerMonitor } from 'electron'
import type { AgentResumeOwner } from '../../shared/agent-resume-owner'
import type { SnoozeTabRequest, SnoozeTabResult } from '../../shared/tab-snooze-types'
import { parseSnoozedTabRef } from '../../shared/tab-snooze-types'
import { agentHookServer } from '../agent-hooks/server'
import type { Store } from '../persistence'
import { mainProcessAgentResumeClaims } from '../pty/agent-resume-claims'
import {
  deleteTerminalScrollbackSnapshotSync,
  readTerminalScrollbackSnapshotSync,
  writeTerminalScrollbackSnapshotSync
} from '../terminal-scrollback-snapshots'
import type { TabSnoozeScrollbackStore, TabSnoozeService } from '../tab-snooze'
import { createTabSnoozeService, setActiveTabSnoozeService } from '../tab-snooze'

export const TAB_SNOOZE_CHANGED_CHANNEL = 'tabSnooze:changed'

const CHANNELS = [
  'tabSnooze:add',
  'tabSnooze:list',
  'tabSnooze:take',
  'tabSnooze:settle',
  'tabSnooze:putBack',
  'tabSnooze:setTime',
  'tabSnooze:discard'
] as const

/**
 * Snoozed output lives in the existing scrollback snapshot store. Why its own
 * key prefix: the session's snapshot for the same tab is deleted as soon as
 * the tab closes, and a snoozed tab's output has to outlive that.
 */
export const snoozedTabScrollbackStore: TabSnoozeScrollbackStore = {
  write: (key, buffer) =>
    writeTerminalScrollbackSnapshotSync({ tabId: `snoozed-tab:${key}`, leafId: 'output', buffer }),
  read: (ref) => readTerminalScrollbackSnapshotSync(ref),
  remove: (ref) => deleteTerminalScrollbackSnapshotSync(ref)
}

/** True when the hook server itself sees this pane running this conversation. */
export function hookServerSeesResumeOwner(owner: AgentResumeOwner): boolean {
  const status = agentHookServer
    .getStatusSnapshot()
    .find((entry) => entry.paneKey === owner.paneKey)
  return Boolean(
    status &&
    status.ptyId === owner.ptyId &&
    status.launchToken === owner.launchToken &&
    status.worktreeId === owner.worktreeId &&
    status.agentType === owner.agent &&
    status.connectionId ===
      (owner.authority.kind === 'ssh' ? owner.authority.connectionId : null) &&
    status.providerSession?.key === owner.providerSession.key &&
    status.providerSession?.id === owner.providerSession.id
  )
}

/** The tab's output as the session last saved it, for a tab that is not on screen. */
function readSessionScrollback(store: Store, tabId: string): string | null {
  const layout = store.getWorkspaceSession()?.terminalLayoutsByTabId?.[tabId]
  const leafId = layout?.root?.type === 'leaf' ? layout.root.leafId : null
  if (!layout || !leafId) {
    return null
  }
  const buffer = layout.buffersByLeafId?.[leafId]
  if (buffer) {
    return buffer
  }
  const ref = layout.scrollbackRefsByLeafId?.[leafId]
  return ref ? readTerminalScrollbackSnapshotSync(ref) : null
}

function broadcastChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(TAB_SNOOZE_CHANGED_CHANNEL)
    }
  }
}

let service: TabSnoozeService | null = null

export function registerTabSnoozeHandlers(store: Store): void {
  if (!service) {
    service = createTabSnoozeService({
      load: () => store.getSnoozedTabs(),
      save: (entries) => store.setSnoozedTabs(entries),
      scrollback: snoozedTabScrollbackStore,
      onChange: broadcastChanged,
      verifyResumeOwner: hookServerSeesResumeOwner,
      onConversationSnoozed: (owner) => {
        mainProcessAgentResumeClaims.forgetStarted(owner)
      }
    })
    setActiveTabSnoozeService(service)
    service.recoverInterruptedReturns()
    // Anything that came due while the app was not running is ready now.
    service.checkDue()
    // Why: a Mac asleep through a wake time may fire the timer late or not at all.
    powerMonitor.on('resume', () => service?.checkDue())
  }
  const snooze = service
  for (const channel of CHANNELS) {
    ipcMain.removeHandler(channel)
  }

  ipcMain.handle('tabSnooze:add', (_event, raw: unknown): SnoozeTabResult => {
    const ref = parseSnoozedTabRef(raw)
    if (!ref) {
      return { ok: false, reason: 'invalid' }
    }
    const request = raw as SnoozeTabRequest
    const scrollback =
      typeof request.scrollback === 'string' && request.scrollback.length > 0
        ? request.scrollback
        : readSessionScrollback(store, ref.tabId)
    return snooze.add({ ...request, scrollback })
  })
  ipcMain.handle('tabSnooze:list', () => snooze.list())
  ipcMain.handle('tabSnooze:take', (_event, raw: unknown, options: unknown) => {
    const ref = parseSnoozedTabRef(raw)
    if (!ref) {
      return null
    }
    const opts = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>
    return snooze.take(ref, {
      onlyReady: opts.onlyReady === true,
      ...(typeof opts.returnTabId === 'string' ? { returnTabId: opts.returnTabId } : {})
    })
  })
  ipcMain.handle('tabSnooze:settle', (_event, raw: unknown) => {
    const ref = parseSnoozedTabRef(raw)
    return ref ? snooze.settle(ref) : false
  })
  ipcMain.handle('tabSnooze:putBack', (_event, raw: unknown) => {
    const ref = parseSnoozedTabRef(raw)
    return ref ? snooze.putBack(ref) : false
  })
  ipcMain.handle('tabSnooze:setTime', (_event, raw: unknown, until: unknown) => {
    const ref = parseSnoozedTabRef(raw)
    return ref ? snooze.setTime(ref, typeof until === 'number' ? until : null) : false
  })
  ipcMain.handle('tabSnooze:discard', (_event, raw: unknown) => {
    const ref = parseSnoozedTabRef(raw)
    return ref ? snooze.discard(ref) : false
  })
}
