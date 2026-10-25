// Intent-before-action choreography for agent-driven browser commands
// (docs/board/research/AGENT-CURSORS-RESEARCH.md §5.3, §6.2, §6.4): clearance,
// soft tile claim, cursor travel (overlay events + CDP mouseMoved so hover
// states fire), hover + dwell, optional human gate, then the action event.
import { randomUUID } from 'node:crypto'
import {
  agentColor,
  type AgentCursorEvent,
  type AgentCursorKind,
  type AgentCursorTarget,
  type AgentCursorTileTarget,
  type AgentGateKind
} from '../../shared/agent-cursor'
import type { AgentCommandIdentity } from './agent-command-context'
import { cursorPath, type CursorPoint } from './agent-cursor-path'
import { BrowserError } from './cdp-bridge'
import {
  AGENT_ACTION_PACE_MS,
  AGENT_GATED_DWELL_MS,
  AGENT_HOVER_DWELL_MS,
  AGENT_HOVER_FALLBACK_BOX_PX,
  AGENT_MOVE_EMIT_INTERVAL_MS,
  PAUSED_EVENT_DELAY_MS,
  defaultSleep,
  type AgentActionStageInput,
  type AgentClearance,
  type AgentCursorDriverOptions,
  type AgentCursorHooks,
  type AgentTargetBox,
  type StagedAgentAction
} from './agent-cursor-driver-types'

export type {
  AgentActionStageInput,
  AgentClearance,
  AgentCursorDriverOptions,
  AgentCursorHooks,
  AgentGateApprovalRequest,
  AgentTargetBox,
  CdpSend,
  StagedAgentAction
} from './agent-cursor-driver-types'


export class AgentCursorDriver {
  private readonly seqByAgent = new Map<string, number>()
  private readonly lastActionEndByAgent = new Map<string, number>()
  private readonly pointByAgentTile = new Map<string, CursorPoint>()
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly paceMs: number
  private readonly dwellMs: number
  private readonly gatedDwellMs: number
  private readonly moveEmitIntervalMs: number
  private readonly log: (message: string) => void

  constructor(
    private readonly hooks: AgentCursorHooks,
    options: AgentCursorDriverOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.paceMs = options.paceMs ?? AGENT_ACTION_PACE_MS
    this.dwellMs = options.dwellMs ?? AGENT_HOVER_DWELL_MS
    this.gatedDwellMs = options.gatedDwellMs ?? AGENT_GATED_DWELL_MS
    this.moveEmitIntervalMs = options.moveEmitIntervalMs ?? AGENT_MOVE_EMIT_INTERVAL_MS
    this.log = options.log ?? ((message) => console.warn(message))
  }

  currentPoint(identity: AgentCommandIdentity, tileId: string): CursorPoint | null {
    return this.pointByAgentTile.get(`${identity.agentId}\u0000${tileId}`) ?? null
  }

  emit(
    identity: AgentCommandIdentity,
    kind: AgentCursorKind,
    extra: Partial<Omit<AgentCursorEvent, 'agentId' | 'name' | 'color' | 'kind' | 'seq' | 'ts'>> = {}
  ): AgentCursorEvent {
    const seq = (this.seqByAgent.get(identity.agentId) ?? 0) + 1
    this.seqByAgent.set(identity.agentId, seq)
    const event: AgentCursorEvent = {
      agentId: identity.agentId,
      name: identity.name,
      color: agentColor(identity.agentId),
      kind,
      seq,
      ts: this.now(),
      ...extra
    }
    try {
      this.hooks.notify(event)
    } catch (error) {
      // Why: a renderer that is not listening must never fail the agent's command.
      this.log(`[agent-cursor] notify failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return event
  }

  /** Emits the completed action and starts the pacing clock for the next one. */
  emitAction(
    identity: AgentCommandIdentity,
    tileId: string,
    kind: AgentCursorKind,
    extra: Partial<Omit<AgentCursorEvent, 'agentId' | 'name' | 'color' | 'kind' | 'seq' | 'ts'>> = {}
  ): AgentCursorEvent {
    const point = this.currentPoint(identity, tileId)
    const target: AgentCursorTarget | undefined =
      extra.target ?? (point ? { tileId, x: point.x, y: point.y } : undefined)
    const event = this.emit(identity, kind, { ...extra, ...(target ? { target } : {}) })
    this.lastActionEndByAgent.set(identity.agentId, this.now())
    return event
  }

  /**
   * Runs everything that must happen before an agent action dispatches:
   * clearance -> pacing -> tile claim -> move (events + CDP mouseMoved) ->
   * hover + dwell -> gate approval. Throws a BrowserError when the agent may
   * not act; the caller dispatches the real action only after this resolves.
   */
  async stage(input: AgentActionStageInput): Promise<StagedAgentAction> {
    const { identity, tileId } = input
    await this.awaitClearance(identity, tileId)
    await this.pace(identity)
    this.claim(identity, tileId)

    const destination = input.point ?? this.defaultPoint(identity, tileId, input.box)
    await this.travel(input, destination)

    const gate = input.gate ?? null
    const box = input.box ?? null
    const hoverTarget: AgentCursorTileTarget = box
      ? { tileId, x: box.x, y: box.y, w: box.w, h: box.h }
      : {
          tileId,
          x: destination.x - AGENT_HOVER_FALLBACK_BOX_PX / 2,
          y: destination.y - AGENT_HOVER_FALLBACK_BOX_PX / 2,
          w: AGENT_HOVER_FALLBACK_BOX_PX,
          h: AGENT_HOVER_FALLBACK_BOX_PX
        }
    this.emit(identity, 'hover', { target: hoverTarget })

    const dwell = gate ? this.gatedDwellMs : identity.fast ? 0 : this.dwellMs
    if (dwell > 0) {
      await this.sleep(dwell)
    }

    if (gate) {
      await this.awaitGate(identity, gate, hoverTarget, input.label)
    }
    // Why: travel, dwell and a gate can take seconds; the user may have paused,
    // stopped or clicked into the tile meanwhile. Nothing dispatches on a stale ok.
    this.throwUnlessClear(
      identity,
      tileId,
      await this.hooks.awaitAgentClearance(identity.agentId, tileId, 0)
    )
    return { point: destination, gate }
  }

  /** Synchronous registry snapshot: a paused/stopped/yielded agent never touches the page. */
  assertClearNow(identity: AgentCommandIdentity, tileId: string): void {
    const clearance = this.hooks.clearanceNow?.(identity.agentId, tileId) ?? 'ok'
    this.throwUnlessClear(identity, tileId, clearance)
  }

  /** Marks a window of agent-originated input on `tileId`; call the result when done. */
  markDispatch(tileId: string): () => void {
    return this.hooks.markAgentDispatch?.(tileId) ?? (() => {})
  }

  /** `thinking` while a long operation runs, `idle` once it ends. */
  status(identity: AgentCommandIdentity, tileId: string, kind: 'thinking' | 'idle'): void {
    this.emit(identity, kind, { target: this.targetOrUndefined(identity, tileId) })
  }

  private async awaitClearance(identity: AgentCommandIdentity, tileId: string): Promise<void> {
    let pausedTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      pausedTimer = null
      this.emit(identity, 'paused', { target: this.targetOrUndefined(identity, tileId) })
    }, PAUSED_EVENT_DELAY_MS)
    let clearance: AgentClearance
    try {
      clearance = await this.hooks.awaitAgentClearance(identity.agentId, tileId)
    } finally {
      if (pausedTimer) {
        clearTimeout(pausedTimer)
      }
    }
    this.throwUnlessClear(identity, tileId, clearance)
  }

  private throwUnlessClear(
    identity: AgentCommandIdentity,
    tileId: string,
    clearance: AgentClearance
  ): void {
    switch (clearance) {
      case 'ok':
        return
      case 'stopped':
        this.emit(identity, 'stopped', { target: this.targetOrUndefined(identity, tileId) })
        throw new BrowserError(
          'agent_stopped',
          `${identity.name} was stopped by the user; no further browser actions will run until resumed.`
        )
      case 'paused':
        throw new BrowserError(
          'agent_paused',
          `${identity.name} is paused (or the user took over). Retry the same command after the user resumes; nothing was dispatched.`
        )
      case 'yielding':
        throw new BrowserError(
          'human_has_control',
          `The user (or another agent) is working inside tile ${tileId}. Wait a few seconds and retry the same command; nothing was dispatched.`
        )
    }
  }

  private async pace(identity: AgentCommandIdentity): Promise<void> {
    const last = this.lastActionEndByAgent.get(identity.agentId)
    if (identity.fast || last === undefined) {
      return
    }
    const remaining = this.paceMs - (this.now() - last)
    if (remaining > 0) {
      await this.sleep(remaining)
    }
  }

  private claim(identity: AgentCommandIdentity, tileId: string): void {
    const result = this.hooks.claimTile(identity.agentId, tileId)
    if (result && result.ok === false) {
      throw new BrowserError(
        'human_has_control',
        `Tile ${tileId} is currently claimed by ${result.heldBy}. Retry in a few seconds; nothing was dispatched.`
      )
    }
  }

  private defaultPoint(
    identity: AgentCommandIdentity,
    tileId: string,
    box: AgentTargetBox | null | undefined
  ): CursorPoint {
    if (box) {
      return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    }
    return this.currentPoint(identity, tileId) ?? { x: 32, y: 32 }
  }

  private async travel(input: AgentActionStageInput, destination: CursorPoint): Promise<void> {
    const { identity, tileId } = input
    const key = `${identity.agentId}\u0000${tileId}`
    const from =
      this.pointByAgentTile.get(key) ??
      // Why: a pointer that appears from a short distance reads as "arriving",
      // a pointer that appears on the target reads as a glitch.
      { x: Math.max(8, destination.x - 160), y: Math.max(8, destination.y - 120) }

    const targetSizePx = input.box ? Math.min(input.box.w, input.box.h) : 0
    const steps = identity.fast
      ? [{ x: destination.x, y: destination.y, at: 0 }]
      : cursorPath(from, destination, { targetSizePx })

    let lastEmitAt = -Infinity
    let previousAt = 0
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const wait = step.at - previousAt
      previousAt = step.at
      if (wait > 0) {
        await this.sleep(wait)
      }
      const isLast = i === steps.length - 1
      if (isLast || step.at - lastEmitAt >= this.moveEmitIntervalMs) {
        lastEmitAt = step.at
        this.emit(identity, 'move', { target: { tileId, x: step.x, y: step.y } })
      }
      this.pointByAgentTile.set(key, { x: step.x, y: step.y })
      await this.dispatchMouseMoved(input, { x: step.x, y: step.y })
    }
  }

  private async dispatchMouseMoved(
    input: AgentActionStageInput,
    point: CursorPoint
  ): Promise<void> {
    if (!input.cdp) {
      return
    }
    const release = this.markDispatch(input.tileId)
    try {
      await input.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log(`[agent-cursor] CDP mouseMoved failed (${message}); using sendInputEvent fallback`)
      if (input.fallbackMouseMove) {
        try {
          input.fallbackMouseMove(point)
        } catch (fallbackError) {
          this.log(
            `[agent-cursor] sendInputEvent fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
          )
        }
      }
    } finally {
      release()
    }
  }

  private async awaitGate(
    identity: AgentCommandIdentity,
    kind: AgentGateKind,
    target: AgentCursorTileTarget,
    label: string | undefined
  ): Promise<void> {
    const requestId = randomUUID()
    this.emit(identity, 'waiting_human', {
      target,
      gated: { kind, requestId },
      ...(label ? { text: label.slice(0, 120) } : {})
    })
    const approved = await this.hooks.requestGateApproval(identity.agentId, { kind, requestId })
    if (!approved) {
      this.emit(identity, 'idle', { target })
      throw new BrowserError(
        'agent_gate_denied',
        `The user did not approve this ${kind} action${label ? ` (${label})` : ''}; nothing was dispatched. Ask the user before retrying.`
      )
    }
  }

  private targetOrUndefined(
    identity: AgentCommandIdentity,
    tileId: string
  ): AgentCursorTileTarget | undefined {
    const point = this.currentPoint(identity, tileId)
    return point ? { tileId, x: point.x, y: point.y } : undefined
  }
}
