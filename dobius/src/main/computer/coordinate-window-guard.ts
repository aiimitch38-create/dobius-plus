import type { ComputerListWindowsResult } from '../../shared/computer-use-runtime-types'
import { RuntimeClientError } from './runtime-client-error'

function usesCoordinates(method: string, params: Record<string, unknown>): boolean {
  if (method === 'click' || method === 'scroll') {
    return params.elementIndex === undefined && params.x !== undefined
  }
  return method === 'drag' && params.fromX !== undefined
}

/**
 * Coordinates are relative to one window. With several windows open (Chrome profiles, Stage
 * Manager), an unpinned click can resolve to a different window than the screenshot showed and
 * press the wrong control, so it must name the window explicitly.
 */
export async function requireWindowForCoordinateAction(
  method: string,
  params: Record<string, unknown>,
  listWindows: (params: { app: unknown }) => Promise<ComputerListWindowsResult>
): Promise<void> {
  if (
    !usesCoordinates(method, params) ||
    params.windowId !== undefined ||
    params.windowIndex !== undefined
  ) {
    return
  }
  const { windows } = await listWindows({ app: params.app })
  const open = windows.filter((window) => !window.isMinimized)
  if (open.length > 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      `${open.length} windows are open for this app, so a coordinate ${method} could hit the wrong one. Pass --window-id from list-windows (the window your screenshot came from), or target an --element-index instead.`
    )
  }
}
