// Smallest the trigger can be; decides whether a viewport can host it at all.
const TRIGGER_MIN_SIZE = 36
// The trigger is the dock pill (`w-80 max-w-[calc(100vw-2rem)]`, a 36px orb row
// with p-2 and a 1px border). Position math must use its real box: the old
// 36px icon size let a right-anchored pill run ~284px off the window.
const TRIGGER_PILL_WIDTH = 320
const TRIGGER_PILL_HEIGHT = 54
const TRIGGER_PILL_VIEWPORT_GUTTER = 32
const DEFAULT_RIGHT_GAP = 24
const DEFAULT_BOTTOM_GAP = 72
const DRAG_MARGIN = 8
const TITLEBAR_SAFE_TOP = 36

export const FLOATING_TERMINAL_TRIGGER_POSITION_STORAGE_KEY =
  'dobius-floating-terminal-trigger-position-v2'

export type FloatingTerminalTriggerPosition = {
  left: number
  top: number
}

export type FloatingTerminalAnchorX = 'left' | 'right'
export type FloatingTerminalAnchorY = 'top' | 'bottom'

export type FloatingTerminalAnchoredTriggerPosition = {
  anchorX: FloatingTerminalAnchorX
  anchorY: FloatingTerminalAnchorY
  offsetX: number
  offsetY: number
}

export type FloatingTerminalTriggerCommittedPosition =
  | FloatingTerminalTriggerPosition
  | FloatingTerminalAnchoredTriggerPosition

export type FloatingTerminalTriggerPositionSource = 'default' | 'user'

function getViewport(): { width: number; height: number } {
  return {
    width: typeof window === 'undefined' ? 1200 : window.innerWidth,
    height: typeof window === 'undefined' ? 800 : window.innerHeight
  }
}

function getTriggerSize(viewport: { width: number; height: number }): {
  width: number
  height: number
} {
  return {
    width: Math.min(
      TRIGGER_PILL_WIDTH,
      Math.max(TRIGGER_MIN_SIZE, viewport.width - TRIGGER_PILL_VIEWPORT_GUTTER)
    ),
    height: TRIGGER_PILL_HEIGHT
  }
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isAnchorX(value: unknown): value is FloatingTerminalAnchorX {
  return value === 'left' || value === 'right'
}

function isAnchorY(value: unknown): value is FloatingTerminalAnchorY {
  return value === 'top' || value === 'bottom'
}

function getWindowStorage(): Storage | null {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
    ? window.localStorage
    : null
}

function isAnchoredTriggerPosition(
  position: FloatingTerminalTriggerCommittedPosition
): position is FloatingTerminalAnchoredTriggerPosition {
  return 'anchorX' in position
}

export function getDefaultFloatingTerminalTriggerCommittedPosition(): FloatingTerminalAnchoredTriggerPosition {
  return {
    anchorX: 'right',
    anchorY: 'bottom',
    offsetX: DEFAULT_RIGHT_GAP,
    offsetY: DEFAULT_BOTTOM_GAP
  }
}

export function getDefaultFloatingTerminalTriggerPosition(): FloatingTerminalTriggerPosition {
  return clampFloatingTerminalTriggerPosition(
    resolveFloatingTerminalTriggerCommittedPosition(
      getDefaultFloatingTerminalTriggerCommittedPosition()
    )
  )
}

export function clampFloatingTerminalTriggerPosition(
  position: FloatingTerminalTriggerPosition
): FloatingTerminalTriggerPosition {
  const viewport = getViewport()
  const size = getTriggerSize(viewport)
  const maxLeft = Math.max(DRAG_MARGIN, viewport.width - size.width - DRAG_MARGIN)
  const maxTop = Math.max(TITLEBAR_SAFE_TOP, viewport.height - size.height - DRAG_MARGIN)
  return {
    left: Math.min(Math.max(DRAG_MARGIN, position.left), maxLeft),
    top: Math.min(Math.max(TITLEBAR_SAFE_TOP, position.top), maxTop)
  }
}

export function hasUsableFloatingTerminalTriggerViewport(): boolean {
  const viewport = getViewport()
  return (
    viewport.width >= TRIGGER_MIN_SIZE + DRAG_MARGIN * 2 &&
    viewport.height >= TRIGGER_MIN_SIZE + TITLEBAR_SAFE_TOP + DRAG_MARGIN
  )
}

export function resolveFloatingTerminalTriggerCommittedPosition(
  position: FloatingTerminalTriggerCommittedPosition
): FloatingTerminalTriggerPosition {
  if (!isAnchoredTriggerPosition(position)) {
    return position
  }
  const viewport = getViewport()
  const size = getTriggerSize(viewport)
  return {
    left:
      position.anchorX === 'left'
        ? position.offsetX
        : viewport.width - size.width - position.offsetX,
    top:
      position.anchorY === 'top'
        ? position.offsetY
        : viewport.height - size.height - position.offsetY
  }
}

export function anchorFloatingTerminalTriggerPosition(
  position: FloatingTerminalTriggerPosition
): FloatingTerminalAnchoredTriggerPosition | null {
  if (!hasUsableFloatingTerminalTriggerViewport()) {
    return null
  }
  const viewport = getViewport()
  const size = getTriggerSize(viewport)
  const anchorX: FloatingTerminalAnchorX =
    position.left + size.width / 2 <= viewport.width / 2 ? 'left' : 'right'
  const anchorY: FloatingTerminalAnchorY =
    position.top + size.height / 2 <= viewport.height / 2 ? 'top' : 'bottom'
  return {
    anchorX,
    anchorY,
    offsetX: anchorX === 'left' ? position.left : viewport.width - position.left - size.width,
    offsetY: anchorY === 'top' ? position.top : viewport.height - position.top - size.height
  }
}

export function shouldReconcileFloatingTerminalTriggerPosition(
  source: FloatingTerminalTriggerPositionSource
): boolean {
  return source === 'default' || hasUsableFloatingTerminalTriggerViewport()
}

export function resolveFloatingTerminalTriggerPosition(
  position: FloatingTerminalTriggerCommittedPosition,
  source: FloatingTerminalTriggerPositionSource
): FloatingTerminalTriggerPosition {
  if (source === 'default') {
    return getDefaultFloatingTerminalTriggerPosition()
  }
  return clampFloatingTerminalTriggerPosition(
    resolveFloatingTerminalTriggerCommittedPosition(position)
  )
}

export function parseFloatingTerminalTriggerPosition(
  serialized: string | null
): FloatingTerminalTriggerCommittedPosition | null {
  if (!serialized) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(serialized)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const record = parsed as Record<string, unknown>
    if (
      isAnchorX(record.anchorX) &&
      isAnchorY(record.anchorY) &&
      isFiniteCoordinate(record.offsetX) &&
      isFiniteCoordinate(record.offsetY)
    ) {
      return {
        anchorX: record.anchorX,
        anchorY: record.anchorY,
        offsetX: record.offsetX,
        offsetY: record.offsetY
      }
    }
    if (!isFiniteCoordinate(record.left) || !isFiniteCoordinate(record.top)) {
      return null
    }
    return { left: record.left, top: record.top }
  } catch {
    return null
  }
}

export function readPersistedFloatingTerminalTriggerPosition(): FloatingTerminalTriggerCommittedPosition | null {
  try {
    return parseFloatingTerminalTriggerPosition(
      getWindowStorage()?.getItem(FLOATING_TERMINAL_TRIGGER_POSITION_STORAGE_KEY) ?? null
    )
  } catch {
    return null
  }
}

export function persistFloatingTerminalTriggerPosition(
  position: FloatingTerminalTriggerCommittedPosition
): void {
  try {
    getWindowStorage()?.setItem(
      FLOATING_TERMINAL_TRIGGER_POSITION_STORAGE_KEY,
      JSON.stringify(position)
    )
  } catch {
    // localStorage may be unavailable; the floating launcher remains session-local.
  }
}
