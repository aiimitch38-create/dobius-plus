// Agent cursor / co-presence contract (docs/board/research/AGENT-CURSORS-RESEARCH.md §6.3,
// WEB-TILE-COPRESENCE-PLAN.md Phase 2). One event stream per agent: main emits,
// the renderer overlay / presence strip / action log consume.
import { z } from 'zod'

export const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export const AGENT_CURSOR_KINDS = [
  'move',
  'hover',
  'click',
  'dblclick',
  'rightclick',
  'drag',
  'type',
  'key',
  'scroll',
  'point',
  'say',
  'thinking',
  'idle',
  'paused',
  'waiting_human',
  'stopped'
] as const
export type AgentCursorKind = (typeof AGENT_CURSOR_KINDS)[number]

export const AGENT_GATE_KINDS = [
  'login',
  'purchase',
  'send',
  'publish',
  'delete',
  'download',
  'unverified'
] as const
export type AgentGateKind = (typeof AGENT_GATE_KINDS)[number]

export const AGENT_CONTROL_ACTIONS = [
  'pause',
  'resume',
  'stop',
  'takeOver',
  'approve',
  'deny'
] as const
export type AgentControlAction = (typeof AGENT_CONTROL_ACTIONS)[number]

/** Guest CSS px inside a web tile (`tileId` = board card id). */
export type AgentCursorTileTarget = { tileId: string; x: number; y: number; w?: number; h?: number }
/** Host window client px (app-level cursors). */
export type AgentCursorWindowTarget = { window: true; x: number; y: number; w?: number; h?: number }
export type AgentCursorTarget = AgentCursorTileTarget | AgentCursorWindowTarget

export type AgentCursorEvent = {
  agentId: string
  name: string
  /** CSS color string (see AGENT_PALETTE / agentColor). */
  color: string
  kind: AgentCursorKind
  target?: AgentCursorTarget
  /** For 'say' (cursor chat) and unmasked 'type'. */
  text?: string
  /** For masked 'type' (secret fields) when `text` is withheld. */
  textLength?: number
  /**
   * Present when the action needs a human approval before it dispatches. Only
   * the window path (`ui:agentCursor`) carries it; copies relayed to paired
   * clients drop `gated` entirely, since approval is window-only.
   */
  gated?: { kind: AgentGateKind; requestId: string }
  /** Monotonic per agent; `move` is advisory, everything else exactly-once. */
  seq: number
  /** Epoch ms, stamped by main. */
  ts: number
  runId?: string
}

const finiteNumber = z.number().finite()
const Rect = {
  x: finiteNumber,
  y: finiteNumber,
  w: finiteNumber.nonnegative().optional(),
  h: finiteNumber.nonnegative().optional()
}

export const AgentIdSchema = z.string().regex(AGENT_ID_PATTERN, 'Invalid agent id')

export const AgentCursorTargetSchema: z.ZodType<AgentCursorTarget> = z.union([
  z.object({ tileId: z.string().min(1).max(200), ...Rect }).strict(),
  z.object({ window: z.literal(true), ...Rect }).strict()
])

/** Validates events crossing the CLI / RPC boundary. Unknown keys are rejected. */
export const AgentCursorEventSchema: z.ZodType<AgentCursorEvent> = z
  .object({
    agentId: AgentIdSchema,
    name: z.string().trim().min(1).max(64),
    color: z.string().trim().min(1).max(64),
    kind: z.enum(AGENT_CURSOR_KINDS),
    target: AgentCursorTargetSchema.optional(),
    text: z.string().max(2000).optional(),
    textLength: z.number().int().nonnegative().max(1_000_000).optional(),
    gated: z
      .object({ kind: z.enum(AGENT_GATE_KINDS), requestId: z.string().min(1).max(200) })
      .strict()
      .optional(),
    seq: z.number().int().nonnegative(),
    ts: z.number().int().positive(),
    runId: z.string().min(1).max(200).optional()
  })
  .strict()

export function parseAgentCursorEvent(input: unknown): AgentCursorEvent {
  return AgentCursorEventSchema.parse(input)
}

export function isAgentId(value: unknown): value is string {
  return typeof value === 'string' && AGENT_ID_PATTERN.test(value)
}

export type AgentPaletteEntry = {
  /** Palette slot id, e.g. "agent-1" (research §6.3 `color` token name). */
  slot: string
  hue: string
  light: string
  dark: string
}

/** Six OKLCH pairs, equal lightness/chroma (research §6.1). Slot 1 is Adam's blue. */
export const AGENT_PALETTE: readonly AgentPaletteEntry[] = [
  { slot: 'agent-1', hue: 'blue', light: 'oklch(0.56 0.17 255)', dark: 'oklch(0.70 0.15 255)' },
  { slot: 'agent-2', hue: 'green', light: 'oklch(0.56 0.17 150)', dark: 'oklch(0.70 0.15 150)' },
  { slot: 'agent-3', hue: 'coral', light: 'oklch(0.56 0.17 30)', dark: 'oklch(0.70 0.15 30)' },
  { slot: 'agent-4', hue: 'violet', light: 'oklch(0.56 0.17 310)', dark: 'oklch(0.70 0.15 310)' },
  { slot: 'agent-5', hue: 'amber', light: 'oklch(0.56 0.17 75)', dark: 'oklch(0.70 0.15 75)' },
  { slot: 'agent-6', hue: 'teal', light: 'oklch(0.56 0.17 195)', dark: 'oklch(0.70 0.15 195)' }
]

/** Carson's pointer: deliberately neutral so agent colors stand out. */
export const HUMAN_CURSOR_COLOR = {
  light: 'oklch(0.35 0.02 255)',
  dark: 'oklch(0.90 0.02 255)'
} as const

const ADAM_AGENT_ID = 'adam'

// Why: FNV-1a keeps the slot stable across processes and restarts without any
// registry; Adam is pinned to slot 1 so his blue never shifts when agents join.
function hashAgentId(agentId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < agentId.length; i++) {
    h ^= agentId.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export function agentPaletteEntry(agentId: string): AgentPaletteEntry {
  const id = agentId.trim().toLowerCase()
  if (id === ADAM_AGENT_ID || id.startsWith(`${ADAM_AGENT_ID}-`) || id.startsWith(`${ADAM_AGENT_ID}:`)) {
    return AGENT_PALETTE[0]
  }
  // Why: other agents spread over slots 2-6 so none collides with Adam's blue.
  const others = AGENT_PALETTE.slice(1)
  return others[hashAgentId(id) % others.length]
}

/** Deterministic CSS color for an agent id; Adam is always blue. */
export function agentColor(agentId: string, scheme: 'light' | 'dark' = 'light'): string {
  return agentPaletteEntry(agentId)[scheme]
}
