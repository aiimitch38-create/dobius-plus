// AdamHermesVoice's types, apart so adam-hermes-voice.ts stays one class.
import type { AdamProgressStep } from '../../shared/adam-progress'
import type { JarvisAskResult } from '../../shared/speech-types'
import type { AdamHermesRuntime } from './adam-hermes-runtime'
import type { HermesDesktopEvent, HermesRpc } from './hermes-desktop-rpc'

export type AdamHermesVoiceOptions = {
  sessionFile: string
  runtime?: () => AdamHermesRuntime | null | Promise<AdamHermesRuntime | null>
  connect?: (
    runtime: AdamHermesRuntime,
    onEvent: (event: HermesDesktopEvent) => void,
    onDisconnect: () => void
  ) => HermesRpc
  approve?: (command: string, description: string) => Promise<boolean>
  turnTimeoutMs?: number
  /** Budget for one context compaction; Hermes' own ceiling is 600s by default. */
  compactionTimeoutMs?: number
  /** Told when Hermes starts or stops compacting ADAM's context (a turn's, or an idle tidy). */
  onCompacting?: (compacting: boolean) => void
  /** What ADAM is doing in the running turn, as a fixed step (adam-progress.ts). */
  onProgress?: (step: AdamProgressStep) => void
}

export type AdamHermesTurn = {
  resolve: (result: JarvisAskResult) => void
  timer?: ReturnType<typeof setTimeout>
  compacting: boolean
}
