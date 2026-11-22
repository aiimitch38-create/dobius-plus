// What the runtime RPC (`dobius adam ...`) may reach of ADAM, filled in by
// jarvis-ipc.ts when the window's voice handlers register. Why a separate
// module: the RPC manifest must not import the Electron-heavy IPC file.
import type { JarvisAskResult, JarvisSpeakOutcome } from '../../shared/speech-types'
import type { AdamAskOptions } from './adam-conversation'

export type JarvisVoiceStatus = {
  shortcutActive: boolean
  phase: string
}

export type JarvisVoiceControls = {
  status: () => JarvisVoiceStatus
  setMode: (active: boolean) => { ok: boolean }
  speak: (text: string) => Promise<JarvisSpeakOutcome>
}

export type AdamRuntimeAccess = {
  /** The one `askAdam` entry point (same Hermes session and thread as voice and the Board). */
  ask: (text: string, options: AdamAskOptions) => Promise<JarvisAskResult>
  isBusy: () => boolean
  voice: JarvisVoiceControls
}

let access: AdamRuntimeAccess | null = null

export function setAdamRuntimeAccess(next: AdamRuntimeAccess | null): void {
  access = next
}

export function adamRuntimeAccess(): AdamRuntimeAccess | null {
  return access
}
