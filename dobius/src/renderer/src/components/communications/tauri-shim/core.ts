/**
 * Electron-backed stand-in for `@tauri-apps/api/core`.
 *
 * The restored Communications tree was written against Tauri. Rather than edit
 * 52 files, the build aliases `@tauri-apps/*` to this directory: the call sites
 * keep their original shape and the bridge underneath is ours. `invoke` lands on
 * the same `window.dobiusCommunications` channel the gateway already serves.
 */
type BridgeResponse =
  | { version: 1; id: string; ok: true; result: unknown }
  | { version: 1; id: string; ok: false; error: { code: string; message: string } }

type CommunicationsBridge = {
  invoke(command: string, args?: unknown): Promise<BridgeResponse>
}

declare global {
  interface Window {
    dobiusCommunications?: CommunicationsBridge
  }
}

/** True whenever the bridge is present — the restored code uses this to decide
 *  whether it is running inside the desktop app rather than a browser tab. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof window.dobiusCommunications?.invoke === 'function'
}

export async function invoke<T = unknown>(command: string, args?: unknown): Promise<T> {
  const bridge = typeof window === 'undefined' ? undefined : window.dobiusCommunications
  if (!bridge) {
    throw new Error('Communications bridge unavailable')
  }
  const response = await bridge.invoke(command, args)
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return response.result as T
}

export type InvokeArgs = Record<string, unknown>
