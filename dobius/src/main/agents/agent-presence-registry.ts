// Co-presence state for agents driving Board web tiles (AGENT-CURSORS-RESEARCH §5.3):
// per-agent pause/stop/take-over, soft tile claims (3 s), human yields (5 s after
// the last human input on a tile) and pending gate approvals. The browser bridge
// asks `awaitAgentClearance` before every action; the renderer and the CLI
// change state through `control` / `yieldTile` (IPC `agents:control` /
// `agents:yield`, RPC `board.agentControl` / `board.agentYield`).
import { z } from 'zod'
import {
  AGENT_CONTROL_ACTIONS,
  AGENT_GATE_KINDS,
  AgentIdSchema,
  type AgentControlAction,
  type AgentGateKind
} from '../../shared/agent-cursor'

export const TILE_CLAIM_TTL_MS = 3_000
export const HUMAN_YIELD_MS = 5_000
export const TAKE_OVER_MS = 10 * 60_000
export const GATE_APPROVAL_TIMEOUT_MS = 120_000
export const CLEARANCE_WAIT_MS = 15_000
const CLEARANCE_POLL_MS = 100

export type AgentClearance = 'ok' | 'paused' | 'stopped' | 'yielding'

export type AgentPresenceState = {
  paused: boolean
  stopped: boolean
  /** Epoch ms until which the human holds the agent's tiles; 0 = not taken over. */
  takenOverUntil: number
}

export type TileClaim = { agentId: string; until: number }

export type AgentGateRequest = { kind: AgentGateKind; requestId: string }

export const AgentControlParams = z
  .object({
    agentId: AgentIdSchema,
    action: z.enum(AGENT_CONTROL_ACTIONS),
    requestId: z.string().min(1).max(200).optional()
  })
  .strict()
export type AgentControlInput = z.infer<typeof AgentControlParams>

/** Actions an agent may apply to itself over RPC/CLI: only ones that reduce its own privilege. */
export const RPC_AGENT_CONTROL_ACTIONS = ['pause', 'stop'] as const
export const RpcAgentControlParams = z
  .object({ agentId: AgentIdSchema, action: z.enum(RPC_AGENT_CONTROL_ACTIONS) })
  .strict()

/**
 * Who is asking. Only the Board renderer (the human) may resume, take over,
 * approve or deny; an agent reaching the registry over RPC can only pause or
 * stop itself.
 */
export type AgentControlSource = 'renderer' | 'rpc'
const RENDERER_ONLY_ACTIONS: ReadonlySet<AgentControlAction> = new Set([
  'resume',
  'takeOver',
  'approve',
  'deny'
])

export const AgentYieldParams = z.object({ cardId: z.string().min(1).max(200) }).strict()
export type AgentYieldInput = z.infer<typeof AgentYieldParams>

export const AgentGateRequestSchema = z
  .object({ kind: z.enum(AGENT_GATE_KINDS), requestId: z.string().min(1).max(200) })
  .strict()

export type AgentControlResult = {
  ok: boolean
  agentId: string
  action: AgentControlAction
  state: AgentPresenceState
  /** For approve/deny: false when no gate with that requestId was pending. */
  gateResolved?: boolean
}

type Waiter = () => void
type PendingGate = { agentId: string; resolve: (approved: boolean) => void; timer: NodeJS.Timeout }

export class AgentPresenceRegistry {
  private readonly agents = new Map<string, AgentPresenceState>()
  private readonly claims = new Map<string, TileClaim>()
  private readonly yields = new Map<string, number>()
  private readonly gates = new Map<string, PendingGate>()
  /** tileId → number of agent CDP dispatches in flight (their input is not human input). */
  private readonly dispatching = new Map<string, number>()
  private readonly waiters = new Set<Waiter>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Validates untrusted IPC/RPC input for `control`. */
  parseControl(input: unknown): AgentControlInput {
    return AgentControlParams.parse(input)
  }

  parseYield(input: unknown): AgentYieldInput {
    return AgentYieldParams.parse(input)
  }

  getState(agentId: string): AgentPresenceState {
    return this.agents.get(agentId) ?? { paused: false, stopped: false, takenOverUntil: 0 }
  }

  private setState(agentId: string, patch: Partial<AgentPresenceState>): AgentPresenceState {
    const next = { ...this.getState(agentId), ...patch }
    this.agents.set(agentId, next)
    this.wake()
    return next
  }

  /** Renderer / CLI control: pause, resume, stop, takeOver, approve, deny. */
  control(input: AgentControlInput, source: AgentControlSource): AgentControlResult {
    const { agentId, action, requestId } = AgentControlParams.parse(input)
    if (source !== 'renderer' && RENDERER_ONLY_ACTIONS.has(action)) {
      throw new Error(`forbidden: ${action} is only available to the Board (human) controls`)
    }
    const base = { agentId, action }
    switch (action) {
      case 'pause':
        // Why: a pause (or take-over) must not leave a gate that a later approve
        // could dispatch while the human believes the agent is halted.
        this.denyGatesFor(agentId)
        return { ...base, ok: true, state: this.setState(agentId, { paused: true }) }
      case 'resume':
        return {
          ...base,
          ok: true,
          state: this.setState(agentId, { paused: false, stopped: false, takenOverUntil: 0 })
        }
      case 'takeOver':
        this.denyGatesFor(agentId)
        return {
          ...base,
          ok: true,
          state: this.setState(agentId, { paused: true, takenOverUntil: this.now() + TAKE_OVER_MS })
        }
      case 'stop': {
        // Why: a stop drops every pending gate for the agent so no approval can
        // dispatch an action after the human asked for a halt.
        this.denyGatesFor(agentId)
        for (const [tileId, claim] of this.claims) {
          if (claim.agentId === agentId) {
            this.claims.delete(tileId)
          }
        }
        return { ...base, ok: true, state: this.setState(agentId, { stopped: true, paused: false }) }
      }
      case 'approve':
      case 'deny': {
        const gate = requestId ? this.gates.get(requestId) : undefined
        const matches = gate !== undefined && gate.agentId === agentId
        if (matches && requestId) {
          this.settleGate(requestId, action === 'approve')
        }
        return { ...base, ok: matches, gateResolved: matches, state: this.getState(agentId) }
      }
    }
  }

  /** The human clicked or typed inside a tile: its agents hold off for HUMAN_YIELD_MS. */
  yieldTile(tileId: string): { tileId: string; until: number } {
    const until = this.now() + HUMAN_YIELD_MS
    this.yields.set(tileId, until)
    return { tileId, until }
  }

  isYielding(tileId: string): boolean {
    const until = this.yields.get(tileId)
    if (until === undefined) {
      return false
    }
    if (until <= this.now()) {
      this.yields.delete(tileId)
      return false
    }
    return true
  }

  getTileClaim(tileId: string): TileClaim | null {
    const claim = this.claims.get(tileId)
    if (!claim) {
      return null
    }
    if (claim.until <= this.now()) {
      this.claims.delete(tileId)
      return null
    }
    return claim
  }

  /** Soft claim renewed per action; refused while another agent's claim is live. */
  claimTile(agentId: string, tileId: string): { ok: true; until: number } | { ok: false; heldBy: string } {
    const current = this.getTileClaim(tileId)
    if (current && current.agentId !== agentId) {
      return { ok: false, heldBy: current.agentId }
    }
    const until = this.now() + TILE_CLAIM_TTL_MS
    this.claims.set(tileId, { agentId, until })
    return { ok: true, until }
  }

  clearance(agentId: string, tileId: string): AgentClearance {
    const state = this.getState(agentId)
    if (state.stopped) {
      return 'stopped'
    }
    if (state.paused || state.takenOverUntil > this.now()) {
      return 'paused'
    }
    const claim = this.getTileClaim(tileId)
    if (this.isYielding(tileId) || (claim !== null && claim.agentId !== agentId)) {
      return 'yielding'
    }
    return 'ok'
  }

  /**
   * Waits (up to `waitMs`) for a pause, take-over, human yield or foreign claim
   * to lift. Resolves 'ok' as soon as the agent may act, 'stopped' immediately,
   * otherwise the blocking state when the wait runs out.
   */
  awaitAgentClearance(
    agentId: string,
    tileId: string,
    waitMs: number = CLEARANCE_WAIT_MS
  ): Promise<AgentClearance> {
    const first = this.clearance(agentId, tileId)
    if (first === 'ok' || first === 'stopped' || waitMs <= 0) {
      return Promise.resolve(first)
    }
    const deadline = this.now() + waitMs
    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | null = null
      const finish = (value: AgentClearance): void => {
        if (timer) {
          clearTimeout(timer)
        }
        this.waiters.delete(check)
        resolve(value)
      }
      const check = (): void => {
        const state = this.clearance(agentId, tileId)
        if (state === 'ok' || state === 'stopped' || this.now() >= deadline) {
          finish(state)
          return
        }
        if (timer) {
          clearTimeout(timer)
        }
        timer = setTimeout(check, CLEARANCE_POLL_MS)
      }
      this.waiters.add(check)
      check()
    })
  }

  /**
   * The browser bridge brackets every CDP input dispatch with this so the
   * guest's input listeners do not mistake agent-injected input for the human.
   * Returns the release function; calling it twice is harmless.
   */
  markAgentDispatch(tileId: string): () => void {
    this.dispatching.set(tileId, (this.dispatching.get(tileId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      const left = (this.dispatching.get(tileId) ?? 1) - 1
      if (left <= 0) {
        this.dispatching.delete(tileId)
      } else {
        this.dispatching.set(tileId, left)
      }
    }
  }

  isAgentDispatching(tileId: string): boolean {
    return (this.dispatching.get(tileId) ?? 0) > 0
  }

  /** Resolves when `board.agentControl` approves/denies `gate.requestId`; false on timeout or stop. */
  requestGateApproval(
    agentId: string,
    gate: AgentGateRequest,
    timeoutMs: number = GATE_APPROVAL_TIMEOUT_MS
  ): Promise<boolean> {
    const { requestId } = AgentGateRequestSchema.parse(gate)
    const existing = this.gates.get(requestId)
    if (existing) {
      this.settleGate(requestId, false)
    }
    if (this.getState(agentId).stopped) {
      return Promise.resolve(false)
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settleGate(requestId, false), timeoutMs)
      this.gates.set(requestId, { agentId, resolve, timer })
    })
  }

  pendingGates(): Array<{ requestId: string; agentId: string }> {
    return [...this.gates].map(([requestId, gate]) => ({ requestId, agentId: gate.agentId }))
  }

  private denyGatesFor(agentId: string): void {
    for (const [id, gate] of this.gates) {
      if (gate.agentId === agentId) {
        this.settleGate(id, false)
      }
    }
  }

  private settleGate(requestId: string, approved: boolean): void {
    const gate = this.gates.get(requestId)
    if (!gate) {
      return
    }
    clearTimeout(gate.timer)
    this.gates.delete(requestId)
    gate.resolve(approved)
  }

  private wake(): void {
    for (const waiter of [...this.waiters]) {
      waiter()
    }
  }

  resetForTest(): void {
    for (const requestId of [...this.gates.keys()]) {
      this.settleGate(requestId, false)
    }
    this.agents.clear()
    this.claims.clear()
    this.yields.clear()
    this.dispatching.clear()
    this.waiters.clear()
  }
}

export const agentPresenceRegistry = new AgentPresenceRegistry()

export function awaitAgentClearance(
  agentId: string,
  tileId: string,
  waitMs?: number
): Promise<AgentClearance> {
  return agentPresenceRegistry.awaitAgentClearance(agentId, tileId, waitMs)
}

export function claimTile(agentId: string, tileId: string): ReturnType<AgentPresenceRegistry['claimTile']> {
  return agentPresenceRegistry.claimTile(agentId, tileId)
}

export function markAgentDispatch(tileId: string): () => void {
  return agentPresenceRegistry.markAgentDispatch(tileId)
}

export function requestGateApproval(
  agentId: string,
  gate: AgentGateRequest,
  timeoutMs?: number
): Promise<boolean> {
  return agentPresenceRegistry.requestGateApproval(agentId, gate, timeoutMs)
}
