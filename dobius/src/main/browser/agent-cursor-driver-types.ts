// Types for the agent cursor driver (kept apart so the driver stays within the
// max-lines budget). See agent-cursor-driver.ts for behaviour.
import type { AgentCursorEvent, AgentGateKind } from '../../shared/agent-cursor'
import type { AgentCommandIdentity } from './agent-command-context'
import type { CursorPoint } from './agent-cursor-path'

export type AgentClearance = 'ok' | 'paused' | 'stopped' | 'yielding'

export type AgentGateApprovalRequest = {
  kind: AgentGateKind
  requestId: string
}

/** Lane T surface the driver depends on; see agent-cursor-hooks.ts for the real wiring. */
export type AgentCursorHooks = {
  notify: (event: AgentCursorEvent) => void
  /** `waitMs` 0 = answer immediately (used for the re-check right before dispatch). */
  awaitAgentClearance: (agentId: string, tileId: string, waitMs?: number) => Promise<AgentClearance>
  claimTile: (
    agentId: string,
    tileId: string
  ) => { ok: true; until: number } | { ok: false; heldBy: string } | void
  requestGateApproval: (agentId: string, gate: AgentGateApprovalRequest) => Promise<boolean>
  /**
   * Brackets synthetic input the agent sends to a tile so main does not mistake
   * it for the human's input (which would yield the tile and block the agent).
   */
  markAgentDispatch?: (tileId: string) => () => void
  /** Synchronous clearance snapshot; the bridge checks it before touching the page. */
  clearanceNow?: (agentId: string, tileId: string) => AgentClearance
}

export type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>

export type AgentTargetBox = { x: number; y: number; w: number; h: number }

export type AgentActionStageInput = {
  identity: AgentCommandIdentity
  tileId: string
  /** Where the pointer should end up. Omitted = stay where the agent's pointer already is. */
  point?: CursorPoint
  /** Element box when a ref/selector resolved; drawn as the hover outline. */
  box?: AgentTargetBox | null
  gate?: AgentGateKind | null
  /** Short human label for the gate prompt ("click Sign in"). */
  label?: string
  cdp?: CdpSend | null
  /** Last-resort pointer move when CDP fails; logged when used. */
  fallbackMouseMove?: ((point: CursorPoint) => void) | null
}

export type StagedAgentAction = {
  point: CursorPoint
  gate: AgentGateKind | null
}

export type AgentCursorDriverOptions = {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Minimum gap between two primitive actions of one agent (watchable pace). */
  paceMs?: number
  dwellMs?: number
  gatedDwellMs?: number
  /** Emit at most one `move` event per this many ms (overlay interpolates the rest). */
  moveEmitIntervalMs?: number
  log?: (message: string) => void
}

export const AGENT_ACTION_PACE_MS = 200
export const AGENT_HOVER_DWELL_MS = 150
export const AGENT_GATED_DWELL_MS = 600
export const AGENT_MOVE_EMIT_INTERVAL_MS = 33
export const AGENT_HOVER_FALLBACK_BOX_PX = 24
// Why: a pause that lifts within a blink should not flash a "paused" pill.
export const PAUSED_EVENT_DELAY_MS = 250

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }
  })
