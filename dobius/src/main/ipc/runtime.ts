import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { DobiusRuntimeService } from '../runtime/dobius-runtime'
import type {
  RuntimeBrowserDriverState,
  RuntimeStatus,
  RuntimeSyncWindowGraphResult,
  RuntimeSyncWindowGraph,
  RuntimeTerminalDriverState
} from '../../shared/runtime-types'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { errorResponse } from '../runtime/rpc/errors'
import { isRegisteredRendererWebContents } from '../window/renderer-window-registry'

// Why: runtime:call reaches every RPC method (terminal.send, git.push, ...)
// with desktop authority and no token. Only the top frame of a first-party app
// window may use it; webview guests and subframes are rejected.
function isTrustedRuntimeCallSender(event: IpcMainInvokeEvent): boolean {
  const sender = event.sender
  if (typeof sender?.isDestroyed !== 'function' || sender.isDestroyed()) {
    return false
  }
  if (!isRegisteredRendererWebContents(sender)) {
    return false
  }
  const frame = event.senderFrame
  return frame != null && frame.parent === null
}

export function registerRuntimeHandlers(runtime: DobiusRuntimeService): void {
  ipcMain.removeHandler('runtime:syncWindowGraph')
  ipcMain.removeHandler('runtime:getStatus')
  ipcMain.removeHandler('runtime:call')

  ipcMain.handle(
    'runtime:syncWindowGraph',
    (event, graph: RuntimeSyncWindowGraph): RuntimeSyncWindowGraphResult => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) {
        throw new Error('Runtime graph sync must originate from a BrowserWindow')
      }
      return runtime.syncWindowGraph(window.id, graph)
    }
  )

  ipcMain.handle('runtime:getStatus', (): RuntimeStatus => {
    return runtime.getStatus()
  })

  ipcMain.handle(
    'runtime:call',
    async (
      event,
      args: { method: string; params?: unknown }
    ): Promise<RuntimeRpcResponse<unknown>> => {
      if (!isTrustedRuntimeCallSender(event)) {
        return errorResponse(
          'desktop-ipc',
          { runtimeId: runtime.getRuntimeId() },
          'forbidden',
          'runtime:call is only available to Dobius app windows'
        ) as RuntimeRpcResponse<unknown>
      }
      return (await new RpcDispatcher({ runtime }).dispatch({
        id: 'desktop-ipc',
        authToken: 'desktop-ipc',
        method: args.method,
        params: args.params
      })) as RuntimeRpcResponse<unknown>
    }
  )

  ipcMain.removeHandler('runtime:getTerminalFitOverrides')
  ipcMain.handle(
    'runtime:getTerminalFitOverrides',
    (): { ptyId: string; mode: 'mobile-fit'; cols: number; rows: number }[] => {
      const overrides = runtime.getAllTerminalFitOverrides()
      return Array.from(overrides.entries()).map(([ptyId, override]) => ({
        ptyId,
        ...override
      }))
    }
  )

  ipcMain.removeHandler('runtime:getTerminalDrivers')
  ipcMain.handle(
    'runtime:getTerminalDrivers',
    (): { ptyId: string; driver: RuntimeTerminalDriverState }[] => {
      const drivers = runtime.getAllTerminalDrivers()
      return Array.from(drivers.entries()).map(([ptyId, driver]) => ({ ptyId, driver }))
    }
  )

  ipcMain.removeHandler('runtime:getBrowserDrivers')
  ipcMain.handle(
    'runtime:getBrowserDrivers',
    (): { browserPageId: string; driver: RuntimeBrowserDriverState }[] => {
      const drivers = runtime.getAllBrowserDrivers()
      return Array.from(drivers.entries()).map(([browserPageId, driver]) => ({
        browserPageId,
        driver
      }))
    }
  )

  // Why: the desktop "Restore" button sets the display mode to 'desktop' and
  // applies it, which restores the PTY to its original dimensions and emits
  // a 'resized' event to any active mobile subscriber. This uses the same
  // code path as the mobile toggle button (terminal.setDisplayMode RPC).
  ipcMain.removeHandler('runtime:restoreTerminalFit')
  ipcMain.handle('runtime:restoreTerminalFit', async (_event, args: { ptyId: string }) => {
    // Why: this IPC powers the desktop "Take back" button. Beyond restoring
    // PTY dims (the original semantic), it now also reclaims the input
    // floor for the desktop via the driver state machine. The lock banner
    // unmounts and desktop input/resize are unblocked until the next
    // mobile interaction takes the floor again. See
    // docs/mobile-presence-lock.md.
    //
    // Why async: reclaimTerminalForDesktop awaits applyMobileDisplayMode's
    // PTY-resize chain. Returning the unresolved Promise to ipcMain made
    // Electron try to structured-clone a Promise — "An object could not
    // be cloned" error — and the renderer's restoreTerminalFit() rejected
    // with no useful info.
    try {
      const reclaimed = await runtime.reclaimTerminalForDesktop(args.ptyId)
      return { restored: reclaimed }
    } catch {
      return { restored: false }
    }
  })

  ipcMain.removeHandler('runtime:reclaimBrowserForDesktop')
  ipcMain.handle(
    'runtime:reclaimBrowserForDesktop',
    (_event, args: { browserPageId: string }): { reclaimed: boolean } => {
      try {
        return { reclaimed: runtime.reclaimBrowserForDesktop(args.browserPageId) }
      } catch {
        return { reclaimed: false }
      }
    }
  )
}
