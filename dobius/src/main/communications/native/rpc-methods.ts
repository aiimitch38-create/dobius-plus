// Wires the pure/injectable logic in this directory to real Electron APIs
// and exposes it as RPC methods (defineMethod), the same shape every other
// RPC surface in src/main/runtime/rpc/methods uses. NATIVE_UX_RPC_METHODS is
// meant to be spread into ALL_RPC_METHODS in
// src/main/runtime/rpc/methods/index.ts, and each command's raw Tauri name
// needs a matching `case` in vendor/buzz-desktop's dobiusCommunications.ts
// plus an entry in shared/communications-bridge.ts's allowlist — see the
// build report for the exact paste-ready snippets (both files are shared
// across parallel builders and are applied centrally, not from here).

import { z } from 'zod'
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  clipboard,
  dialog,
  nativeImage,
  powerMonitor,
  systemPreferences,
  type NativeImage
} from 'electron'
import { defineMethod, type RpcAnyMethod } from '../../runtime/rpc/core'
import { OptionalPlainString, requiredString } from '../../runtime/rpc/schemas'
import { getOsIdleSeconds } from './idle-time'
import { performSidebarDefaultHaptic } from './haptic-feedback'
import { performTitleBarDoubleClickAction, type TitleBarWindowHandle } from './title-bar-double-click'
import { setWindowVibrancy, type VibrancyWindowHandle } from './window-vibrancy'
import { createTrayActionQueue } from './tray-action-queue'
import {
  clearTrayAgentActivity,
  updateTrayAgentActivity,
  type TrayHandle,
  type TrayMenuItem
} from './agent-activity-tray'
import { showNativeNotification } from './native-notification'
import { copyImageToClipboard, copyTextToClipboard } from './clipboard-write'
import { downloadFile, downloadImage } from './native-download'
import { isAutoUpdateSupported, isRunningFromAppImage } from './auto-update-support'

// Why: Electron GC-collects a Tray with no live reference; hold it at module
// scope like Dobius's own tray (src/main/tray/system-tray.ts) does. This is
// a SEPARATE Tray instance from that one — see agent-activity-tray.ts.
let agentActivityTray: Tray | null = null

// Why: Tray's real setContextMenu(menu: Menu | null) is narrower than the
// TrayHandle contract's setContextMenu(menu: unknown) — this adapter is the
// one place that cast happens, kept safe because buildMenuFromTemplate below
// is the only producer of the `unknown` this receives.
function asTrayHandle(tray: Tray): TrayHandle {
  return {
    isDestroyed: () => tray.isDestroyed(),
    setToolTip: (text) => tray.setToolTip(text),
    setContextMenu: (menu) => tray.setContextMenu(menu as Menu),
    destroy: () => tray.destroy()
  }
}

function getOrCreateAgentActivityTray(): TrayHandle {
  if (!agentActivityTray || agentActivityTray.isDestroyed()) {
    // Why: Tray requires a real image; an empty template image renders as a
    // blank/transparent glyph on macOS menu bars rather than throwing, which
    // is an acceptable placeholder until product supplies a dedicated asset.
    agentActivityTray = new Tray(nativeImage.createEmpty())
    agentActivityTray.setToolTip('Dobius Communications')
  }
  return asTrayHandle(agentActivityTray)
}

function buildMenuFromTemplate(template: TrayMenuItem[]): Menu {
  return Menu.buildFromTemplate(
    template.map((item) =>
      item.type === 'separator'
        ? { type: 'separator' as const }
        : { label: item.label, enabled: item.enabled, click: item.click }
    )
  )
}

const trayActionQueue = createTrayActionQueue()

function firstLiveWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null
}

// Why: BrowserWindow#setVibrancy only accepts Electron's Vibrancy union, a
// narrower type than the VibrancyWindowHandle contract's plain `string |
// null` — this adapter is the one place that cast happens.
function asVibrancyWindow(win: BrowserWindow): VibrancyWindowHandle {
  return {
    isDestroyed: () => win.isDestroyed(),
    setVibrancy: (material) => win.setVibrancy(material as Parameters<BrowserWindow['setVibrancy']>[0])
  }
}

function asTitleBarWindow(win: BrowserWindow): TitleBarWindowHandle {
  return {
    isDestroyed: () => win.isDestroyed(),
    isMaximized: () => win.isMaximized(),
    minimize: () => win.minimize(),
    maximize: () => win.maximize(),
    unmaximize: () => win.unmaximize()
  }
}

function macDoubleClickPreference(): string | null {
  if (process.platform !== 'darwin') {
    return null
  }
  try {
    return systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string') || null
  } catch {
    return null
  }
}

const TrayActivity = z.object({
  activityId: requiredString('Missing activity id'),
  agentName: requiredString('Missing agent name'),
  channelId: requiredString('Missing channel id'),
  channelName: requiredString('Missing channel name'),
  elapsed: requiredString('Missing elapsed label')
})

const UpdateTrayAgentActivityParams = z.object({
  activities: z.array(TrayActivity),
  recentActivities: z.array(TrayActivity)
})

const TrayAction = z.union([
  z.object({ kind: z.literal('newChannel') }),
  z.object({ kind: z.literal('openChannel'), channelId: requiredString('Missing channel id') })
])

const RequeueTrayActionsParams = z.object({
  actions: z.array(TrayAction)
})

const SetWindowVibrancyParams = z.object({
  enabled: z.boolean(),
  material: requiredString('Missing vibrancy material')
})

const CopyTextToClipboardParams = z.object({
  text: requiredString('Missing text'),
  html: OptionalPlainString
})

const UrlParams = z.object({
  url: requiredString('Missing url')
})

const DownloadFileParams = z.object({
  url: requiredString('Missing url'),
  filename: requiredString('Missing filename')
})

const ShowNativeNotificationParams = z.object({
  title: requiredString('Missing title'),
  body: requiredString('Missing body'),
  target: z.unknown().optional()
})

export const NATIVE_UX_RPC_METHODS: readonly RpcAnyMethod[] = [
  defineMethod({
    name: 'nativeUx.getIdleSeconds',
    params: null,
    handler: () => getOsIdleSeconds({ getSystemIdleTime: () => powerMonitor.getSystemIdleTime() })
  }),
  defineMethod({
    name: 'nativeUx.performSidebarHaptic',
    params: null,
    handler: () => performSidebarDefaultHaptic()
  }),
  defineMethod({
    name: 'nativeUx.titleBarDoubleClick',
    params: null,
    handler: () =>
      performTitleBarDoubleClickAction({
        platform: process.platform,
        getDoubleClickPreference: macDoubleClickPreference,
        getTargetWindow: (): TitleBarWindowHandle | null => {
          const win = firstLiveWindow()
          return win ? asTitleBarWindow(win) : null
        }
      })
  }),
  defineMethod({
    name: 'nativeUx.setWindowVibrancy',
    params: SetWindowVibrancyParams,
    handler: (params) =>
      setWindowVibrancy(params, {
        platform: process.platform,
        getTargetWindows: (): VibrancyWindowHandle[] =>
          BrowserWindow.getAllWindows().map(asVibrancyWindow)
      })
  }),
  defineMethod({
    name: 'nativeUx.trayTakeActions',
    params: null,
    handler: () => trayActionQueue.takeAll()
  }),
  defineMethod({
    name: 'nativeUx.trayRequeueActions',
    params: RequeueTrayActionsParams,
    handler: (params) => {
      trayActionQueue.requeue(params.actions)
      return { requeued: params.actions.length }
    }
  }),
  defineMethod({
    name: 'nativeUx.trayUpdateAgentActivity',
    params: UpdateTrayAgentActivityParams,
    handler: (params) =>
      updateTrayAgentActivity(params, {
        getOrCreateTray: getOrCreateAgentActivityTray,
        buildMenuFromTemplate,
        actionQueue: trayActionQueue,
        // Why: no live consumer of a "tray action available" push exists yet
        // — see the build report. Left as a documented no-op call site so
        // wiring a real event later is a one-line change here.
        notifyActionAvailable: () => {}
      })
  }),
  defineMethod({
    name: 'nativeUx.trayClearAgentActivity',
    params: null,
    handler: () =>
      clearTrayAgentActivity({
        getOrCreateTray: getOrCreateAgentActivityTray,
        buildMenuFromTemplate,
        actionQueue: trayActionQueue,
        notifyActionAvailable: () => {}
      })
  }),
  defineMethod({
    name: 'nativeUx.showNotification',
    params: ShowNativeNotificationParams,
    handler: (params) =>
      showNativeNotification(params, {
        isSupported: () => Notification.isSupported(),
        createNotification: ({ title, body }) => new Notification({ title, body }),
        onClicked: () => {
          // Why: no renderer-side consumer exists for the click target yet
          // (COMMUNICATIONS_BRIDGE_EVENT_CHANNEL has no listener wired) — see
          // the build report. Best-effort: bring the app forward on click.
          firstLiveWindow()?.focus()
        }
      })
  }),
  defineMethod({
    name: 'media.copyTextToClipboard',
    params: CopyTextToClipboardParams,
    handler: (params) =>
      copyTextToClipboard(params, {
        writeText: (text) => clipboard.writeText(text),
        writeTextAndHtml: ({ text, html }) => clipboard.write({ text, html })
      })
  }),
  defineMethod({
    name: 'media.copyImageToClipboard',
    params: UrlParams,
    handler: (params) =>
      copyImageToClipboard(params, {
        createImageFromBuffer: (buffer) => nativeImage.createFromBuffer(buffer),
        writeImage: (image) => clipboard.writeImage(image as NativeImage),
        fetchBytes: fetchUrlBytes
      })
  }),
  defineMethod({
    name: 'media.downloadFile',
    params: DownloadFileParams,
    handler: (params) =>
      downloadFile(params, {
        fetchBytes: fetchUrlBytes,
        showSaveDialog: async (defaultFilename) => {
          const win = firstLiveWindow()
          const result = win
            ? await dialog.showSaveDialog(win, { defaultPath: defaultFilename })
            : await dialog.showSaveDialog({ defaultPath: defaultFilename })
          return { canceled: result.canceled, filePath: result.filePath }
        },
        writeFile: (filePath, data) => writeFileBytes(filePath, data)
      })
  }),
  defineMethod({
    name: 'media.downloadImage',
    params: UrlParams,
    handler: (params) =>
      downloadImage(params, {
        fetchBytes: fetchUrlBytes,
        showSaveDialog: async (defaultFilename) => {
          const win = firstLiveWindow()
          const result = win
            ? await dialog.showSaveDialog(win, { defaultPath: defaultFilename })
            : await dialog.showSaveDialog({ defaultPath: defaultFilename })
          return { canceled: result.canceled, filePath: result.filePath }
        },
        writeFile: (filePath, data) => writeFileBytes(filePath, data)
      })
  }),
  defineMethod({
    name: 'updater.isAutoUpdateSupported',
    params: null,
    handler: () =>
      isAutoUpdateSupported({ platform: process.platform, isRunningFromAppImage })
  })
]

async function fetchUrlBytes(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

async function writeFileBytes(filePath: string, data: Buffer): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(filePath, data)
}
