import { BrowserWindow, ipcMain, powerMonitor } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { AgentResumeOwner } from '../../shared/agent-resume-owner'
import type { SnoozeTabRequest, SnoozeTabResult } from '../../shared/tab-snooze-types'
import { parseSnoozedTabRef } from '../../shared/tab-snooze-types'
import { agentHookServer } from '../agent-hooks/server'
import type { Store } from '../persistence'
import {
  deleteTerminalScrollbackSnapshotSync,
  readTerminalScrollbackSnapshotSync,
  writeTerminalScrollbackSnapshotSync
} from '../terminal-scrollback-snapshots'
import type { TabSnoozeScrollbackStore, TabSnoozeService } from '../tab-snooze'
import { createTabSnoozeService, setActiveTabSnoozeService } from '../tab-snooze'
import { isRegisteredRendererWebContents } from '../window/renderer-window-registry'

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

// Why: these channels close tabs' conversations out of the session and hand
// them back, so, like runtime:call, only the top frame of a first-party app
// window may use them; webview guests and sub-frames are rejected.
function assertAppWindowSender(event: IpcMainInvokeEvent, channel: string): void {
  const sender = event?.sender
  if (
    typeof sender?.isDestroyed !== 'function' ||
    sender.isDestroyed() ||
    !isRegisteredRendererWebContents(sender) ||
    event.senderFrame == null ||
    event.senderFrame.parent !== null
  ) {
    throw new Error(`forbidden: ${channel} is only available to Dobius app windows`)
  }
}

const watchedRenderers = new WeakSet<WebContents>()

/** A window that closes, crashes or reloads mid-return gives its entries back. */
function watchRenderer(sender: WebContents): void {
  if (watchedRenderers.has(sender)) {
    return
  }
  watchedRenderers.add(sender)
  const { id } = sender
  const release = (): void => {
    service?.releaseRenderer(id)
  }
  sender.once('destroyed', release)
  sender.on('render-process-gone', release)
  // Why: a reloaded page has forgotten which tabs it was bringing back.
  sender.on('did-navigate', release)
}

export function registerTabSnoozeHandlers(store: Store): void {
  if (!service) {
    service = createTabSnoozeService({
      load: () => store.getSnoozedTabs(),
      save: (entries) => store.setSnoozedTabs(entries),
      scrollback: snoozedTabScrollbackStore,
      onChange: broadcastChanged,
      verifyResumeOwner: hookServerSeesResumeOwner
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

  const handle = <Args extends unknown[], Result>(
    channel: (typeof CHANNELS)[number],
    handler: (sender: WebContents, ...args: Args) => Result
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      assertAppWindowSender(event, channel)
      return handler(event.sender, ...(args as Args))
    })
  }

  handle('tabSnooze:add', (_sender, raw: unknown): SnoozeTabResult => {
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
  handle('tabSnooze:list', () => snooze.list())
  handle('tabSnooze:take', (sender, raw: unknown, options: unknown) => {
    const ref = parseSnoozedTabRef(raw)
    if (!ref) {
      return null
    }
    const opts = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>
    watchRenderer(sender)
    return snooze.take(ref, {
      onlyReady: opts.onlyReady === true,
      rendererId: sender.id,
      ...(typeof opts.returnTabId === 'string' ? { returnTabId: opts.returnTabId } : {})
    })
  })
  handle('tabSnooze:settle', (sender, raw: unknown) => {
    const ref = parseSnoozedTabRef(raw)
    return ref ? snooze.settle(ref, sender.id) : false
  })
  handle('tabSnooze:putBack', (sender, raw: unknown) => {
    const ref = parseSnoozedTabRef(raw)
    return ref ? snooze.putBack(ref, sender.id) : false
  })
  handle('tabSnooze:setTime', (_sender, raw: unknown, until: unknown) => {
    const ref = parseSnoozedTabRef(raw)
    return ref ? snooze.setTime(ref, typeof until === 'number' ? until : null) : false
  })
  handle('tabSnooze:discard', (_sender, raw: unknown) => {
    const ref = parseSnoozedTabRef(raw)
    return ref ? snooze.discard(ref) : false
  })
}
