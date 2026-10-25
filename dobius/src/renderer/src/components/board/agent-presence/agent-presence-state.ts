// Per-agent co-presence state for the Board overlay and presence strip.
// Fed by the cursor inbox (main → ui:agentCursor); Excalidraw's three-state
// presence model (active / idle after 60 s / away after 5 min, 3 s heartbeat).
import { create } from 'zustand'
import {
  agentPaletteEntry,
  type AgentControlAction,
  type AgentCursorEvent,
  type AgentCursorKind,
  type AgentCursorTarget,
  type AgentGateKind
} from '../../../../../shared/agent-cursor'
import { subscribeAgentCursor } from './agent-cursor-inbox'

export const AGENT_IDLE_AFTER_MS = 60_000
export const AGENT_AWAY_AFTER_MS = 5 * 60_000
export const AGENT_HEARTBEAT_MS = 3_000
/** A tile claim is shown for this long after the agent's last action (matches main's claim TTL). */
export const AGENT_CLAIM_TTL_MS = 3_000

export type AgentUserState = 'active' | 'idle' | 'away'
export type AgentRippleKind = 'click' | 'dblclick' | 'rightclick'
export type AgentRipple = { seq: number; kind: AgentRippleKind; target: AgentCursorTarget }

export type AgentPresence = {
  id: string
  name: string
  /** CSS custom property reference for the agent's palette slot (never a literal color). */
  color: string
  pointer: AgentCursorTarget | null
  /** Box the agent is dwelling on (hover / point); cleared by the next move. */
  hover: AgentCursorTarget | null
  lastKind: AgentCursorKind
  lastSeq: number
  lastEventAt: number
  /** Last move/hover/click/type/... event; drives the claim chip TTL. */
  lastActionAt: number
  userState: AgentUserState
  claimedTileId: string | null
  gated: { kind: AgentGateKind; requestId: string } | null
  paused: boolean
  stopped: boolean
  /** Carson explicitly took over (agents.control takeOver); Resume hands control back. */
  yielded: boolean
  /** Main holds the agent until this epoch ms after Carson acted in its tile (plain yield). */
  yieldedUntil: number | null
  waiting: boolean
  thinking: boolean
  typing: boolean
  text: string | null
  ripple: AgentRipple | null
}

type AgentPresenceStore = {
  agents: Record<string, AgentPresence>
  followAgentId: string | null
}

export const useAgentPresence = create<AgentPresenceStore>(() => ({
  agents: {},
  followAgentId: null
}))

const ACTION_KINDS: ReadonlySet<AgentCursorKind> = new Set([
  'move',
  'hover',
  'click',
  'dblclick',
  'rightclick',
  'drag',
  'type',
  'key',
  'scroll',
  'point'
])

const APPLIED_SEQ_CAP = 256
const appliedSeqs = new Map<string, number[]>()

function alreadyApplied(agentId: string, seq: number): boolean {
  const seen = appliedSeqs.get(agentId) ?? []
  if (seen.includes(seq)) {
    return true
  }
  seen.push(seq)
  if (seen.length > APPLIED_SEQ_CAP) {
    seen.splice(0, seen.length - APPLIED_SEQ_CAP)
  }
  appliedSeqs.set(agentId, seen)
  return false
}

export function agentColorVar(agentId: string): string {
  return `var(--${agentPaletteEntry(agentId).slot})`
}

function freshPresence(event: AgentCursorEvent, now: number): AgentPresence {
  return {
    id: event.agentId,
    name: event.name,
    color: agentColorVar(event.agentId),
    pointer: null,
    hover: null,
    lastKind: event.kind,
    lastSeq: -1,
    lastEventAt: now,
    lastActionAt: 0,
    userState: 'active',
    claimedTileId: null,
    gated: null,
    paused: false,
    stopped: false,
    yielded: false,
    yieldedUntil: null,
    waiting: false,
    thinking: false,
    typing: false,
    text: null,
    ripple: null
  }
}

function isTileTarget(target: AgentCursorTarget | undefined): target is Extract<
  AgentCursorTarget,
  { tileId: string }
> {
  return !!target && 'tileId' in target
}

function hasSize(target: AgentCursorTarget | undefined): boolean {
  return !!target && ((target.w ?? 0) > 0 || (target.h ?? 0) > 0)
}

function reduce(prev: AgentPresence, event: AgentCursorEvent, now: number): AgentPresence {
  const target = event.target
  const next: AgentPresence = {
    ...prev,
    name: event.name,
    lastKind: event.kind,
    lastSeq: Math.max(prev.lastSeq, event.seq),
    lastEventAt: now,
    userState: 'active',
    gated: event.gated ?? null,
    waiting: !!event.gated
  }
  if (ACTION_KINDS.has(event.kind)) {
    // Why: an acting agent is by definition not paused, stopped, held or thinking.
    next.paused = false
    next.stopped = false
    next.yielded = false
    next.yieldedUntil = null
    next.thinking = false
    next.lastActionAt = now
    // Why: hover/point targets are the element's RECT (top-left + size), not a
    // pointer position; assigning them would snap the arrow to the corner.
    const boxOnly = event.kind === 'hover' || (event.kind === 'point' && hasSize(target))
    if (target && !boxOnly) {
      next.pointer = target
    }
    if (isTileTarget(target)) {
      next.claimedTileId = target.tileId
    }
  }
  switch (event.kind) {
    case 'move':
      next.hover = null
      next.typing = false
      break
    case 'hover':
    case 'point':
      next.hover = target ?? null
      break
    case 'click':
    case 'dblclick':
    case 'rightclick':
      next.typing = false
      if (target) {
        next.ripple = { seq: event.seq, kind: event.kind, target }
      }
      break
    case 'type':
      next.typing = true
      next.text = event.text ?? null
      break
    case 'say':
      next.text = event.text ?? null
      break
    case 'thinking':
      next.thinking = true
      next.typing = false
      break
    case 'idle':
      next.thinking = false
      next.typing = false
      next.claimedTileId = null
      break
    case 'paused':
      next.paused = true
      next.typing = false
      break
    case 'waiting_human':
      next.waiting = true
      next.typing = false
      break
    case 'stopped':
      next.stopped = true
      next.paused = false
      next.typing = false
      next.thinking = false
      next.pointer = null
      next.hover = null
      next.claimedTileId = null
      break
    default:
      break
  }
  return next
}

/** Applies one event; `move` older than the last seq is dropped, other kinds apply once. */
export function applyAgentCursorEvent(event: AgentCursorEvent, now = Date.now()): boolean {
  const { agents } = useAgentPresence.getState()
  const prev = agents[event.agentId] ?? freshPresence(event, now)
  if (event.kind === 'move') {
    if (event.seq <= prev.lastSeq) {
      return false
    }
  } else if (alreadyApplied(event.agentId, event.seq)) {
    return false
  }
  useAgentPresence.setState({ agents: { ...agents, [event.agentId]: reduce(prev, event, now) } })
  return true
}

function stateFor(sinceMs: number): AgentUserState {
  if (sinceMs >= AGENT_AWAY_AFTER_MS) {
    return 'away'
  }
  return sinceMs >= AGENT_IDLE_AFTER_MS ? 'idle' : 'active'
}

/** Heartbeat: fades agents that stopped sending events, releases claims, expires holds. */
export function tickAgentPresence(now = Date.now()): void {
  const { agents } = useAgentPresence.getState()
  let changed = false
  const next: Record<string, AgentPresence> = {}
  for (const agent of Object.values(agents)) {
    const userState = stateFor(now - agent.lastEventAt)
    const holdExpired = agent.yieldedUntil !== null && agent.yieldedUntil <= now
    if (userState === agent.userState && !holdExpired) {
      next[agent.id] = agent
      continue
    }
    changed = true
    next[agent.id] = {
      ...agent,
      userState,
      claimedTileId: userState === 'active' ? agent.claimedTileId : null,
      yieldedUntil: holdExpired ? null : agent.yieldedUntil
    }
  }
  if (changed) {
    useAgentPresence.setState({ agents: next })
  }
}

function patchAgent(agentId: string, patch: Partial<AgentPresence>): void {
  const { agents } = useAgentPresence.getState()
  const agent = agents[agentId]
  if (agent) {
    useAgentPresence.setState({ agents: { ...agents, [agentId]: { ...agent, ...patch } } })
  }
}

/** Optimistic local effect of a control button; main confirms with its own events. */
export function markAgentControl(agentId: string, action: AgentControlAction): void {
  switch (action) {
    case 'pause':
      patchAgent(agentId, { paused: true })
      break
    case 'resume':
      patchAgent(agentId, { paused: false, yielded: false, yieldedUntil: null, stopped: false })
      break
    case 'stop':
      patchAgent(agentId, { stopped: true, paused: false, pointer: null, claimedTileId: null })
      break
    case 'takeOver':
      patchAgent(agentId, { yielded: true, paused: true })
      break
    case 'approve':
    case 'deny':
      patchAgent(agentId, { gated: null, waiting: false })
      break
    default:
      break
  }
}

/** Plain yield: main holds every agent claiming the tile until `until`. Returns their ids. */
export function markTileYield(tileId: string, until: number): string[] {
  const { agents } = useAgentPresence.getState()
  const ids = Object.values(agents)
    .filter((a) => a.claimedTileId === tileId && !a.stopped)
    .map((a) => a.id)
  if (ids.length > 0) {
    const next = { ...agents }
    for (const id of ids) {
      next[id] = { ...next[id], yieldedUntil: until }
    }
    useAgentPresence.setState({ agents: next })
  }
  return ids
}

export function clearAgentYield(agentId: string): void {
  patchAgent(agentId, { yieldedUntil: null })
}

export function removeAgent(agentId: string): void {
  const { agents, followAgentId } = useAgentPresence.getState()
  if (!agents[agentId]) {
    return
  }
  const next = { ...agents }
  delete next[agentId]
  useAgentPresence.setState({
    agents: next,
    followAgentId: followAgentId === agentId ? null : followAgentId
  })
}

export function claimantOfTile(tileId: string): AgentPresence | null {
  return (
    Object.values(useAgentPresence.getState().agents).find(
      (a) => a.claimedTileId === tileId && !a.stopped
    ) ?? null
  )
}

/** True while the claim is fresh (last action within the TTL) or the agent is held/taken over. */
export function claimActive(agent: AgentPresence, now = Date.now()): boolean {
  if (!agent.claimedTileId || agent.stopped) {
    return false
  }
  if (agent.yielded || (agent.yieldedUntil !== null && agent.yieldedUntil > now)) {
    return true
  }
  return now - agent.lastActionAt < AGENT_CLAIM_TTL_MS
}

export function setFollowedAgent(agentId: string | null): void {
  useAgentPresence.setState({ followAgentId: agentId })
}

/** Wires the inbox and heartbeat; returns the teardown. Mounted once by the cursor layer. */
export function startAgentPresence(): () => void {
  const unsubscribe = subscribeAgentCursor((event) => applyAgentCursorEvent(event))
  const timer = setInterval(() => tickAgentPresence(), AGENT_HEARTBEAT_MS)
  return () => {
    unsubscribe()
    clearInterval(timer)
  }
}

export function resetAgentPresenceForTest(): void {
  appliedSeqs.clear()
  useAgentPresence.setState({ agents: {}, followAgentId: null })
}
