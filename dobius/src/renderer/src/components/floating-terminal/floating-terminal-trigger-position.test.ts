import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FLOATING_TERMINAL_TRIGGER_POSITION_STORAGE_KEY,
  anchorFloatingTerminalTriggerPosition,
  clampFloatingTerminalTriggerPosition,
  getDefaultFloatingTerminalTriggerCommittedPosition,
  getDefaultFloatingTerminalTriggerPosition,
  hasUsableFloatingTerminalTriggerViewport,
  parseFloatingTerminalTriggerPosition,
  persistFloatingTerminalTriggerPosition,
  readPersistedFloatingTerminalTriggerPosition,
  resolveFloatingTerminalTriggerCommittedPosition,
  resolveFloatingTerminalTriggerPosition,
  shouldReconcileFloatingTerminalTriggerPosition
} from './floating-terminal-trigger-position'

function stubViewport(width: number, height: number, localStorage?: Partial<Storage>): void {
  vi.stubGlobal('window', { innerWidth: width, innerHeight: height, localStorage })
}

describe('floating terminal trigger position', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to the bottom right of the viewport', () => {
    stubViewport(1200, 800)

    expect(getDefaultFloatingTerminalTriggerCommittedPosition()).toEqual({
      anchorX: 'right',
      anchorY: 'bottom',
      offsetX: 24,
      offsetY: 72
    })
    expect(getDefaultFloatingTerminalTriggerPosition()).toEqual({
      left: 856,
      top: 674
    })
  })

  it('converts each anchored position into viewport coordinates', () => {
    stubViewport(1200, 800)

    expect(
      resolveFloatingTerminalTriggerCommittedPosition({
        anchorX: 'left',
        anchorY: 'top',
        offsetX: 40,
        offsetY: 48
      })
    ).toEqual({ left: 40, top: 48 })
    expect(
      resolveFloatingTerminalTriggerCommittedPosition({
        anchorX: 'right',
        anchorY: 'bottom',
        offsetX: 24,
        offsetY: 72
      })
    ).toEqual({ left: 856, top: 674 })
  })

  it('clamps parked positions into the viewport', () => {
    stubViewport(640, 480)

    expect(clampFloatingTerminalTriggerPosition({ left: 900, top: -20 })).toEqual({
      left: 312,
      top: 36
    })
  })

  it('re-anchors default positions when startup viewport dimensions change', () => {
    stubViewport(0, 0)
    const initialPosition = getDefaultFloatingTerminalTriggerPosition()

    stubViewport(1200, 800)

    expect(resolveFloatingTerminalTriggerPosition(initialPosition, 'default')).toEqual({
      left: 856,
      top: 674
    })
  })

  it('clamps user-placed positions instead of re-anchoring them on resize', () => {
    stubViewport(1200, 800)

    // The 320px-wide pill must end 8px inside the right edge: 1200 - 320 - 8.
    expect(resolveFloatingTerminalTriggerPosition({ left: 900, top: 500 }, 'user')).toEqual({
      left: 872,
      top: 500
    })
  })

  it('preserves right-bottom anchored placements across skinny viewport clamps', () => {
    const committed = {
      anchorX: 'right' as const,
      anchorY: 'bottom' as const,
      offsetX: 48,
      offsetY: 80
    }
    stubViewport(260, 220)
    expect(resolveFloatingTerminalTriggerPosition(committed, 'user')).toEqual({
      left: 8,
      top: 86
    })

    stubViewport(1200, 800)
    expect(resolveFloatingTerminalTriggerPosition(committed, 'user')).toEqual({
      left: 832,
      top: 666
    })
  })

  it('preserves left-top anchored placements across resize', () => {
    const committed = anchorFloatingTerminalTriggerPosition({ left: 32, top: 44 })

    expect(committed).toEqual({
      anchorX: 'left',
      anchorY: 'top',
      offsetX: 32,
      offsetY: 44
    })

    stubViewport(1200, 800)
    expect(resolveFloatingTerminalTriggerPosition(committed!, 'user')).toEqual({
      left: 32,
      top: 44
    })
  })

  it('ignores malformed persisted positions', () => {
    stubViewport(640, 480)

    expect(parseFloatingTerminalTriggerPosition('not-json')).toBeNull()
    expect(parseFloatingTerminalTriggerPosition('{"left":"1","top":2}')).toBeNull()
    expect(
      parseFloatingTerminalTriggerPosition(
        '{"anchorX":"center","anchorY":"bottom","offsetX":24,"offsetY":72}'
      )
    ).toBeNull()
    expect(
      parseFloatingTerminalTriggerPosition(
        '{"anchorX":"right","anchorY":"bottom","offsetX":24,"offsetY":null}'
      )
    ).toBeNull()
  })

  it('parses anchored and legacy persisted positions', () => {
    expect(
      parseFloatingTerminalTriggerPosition(
        '{"anchorX":"right","anchorY":"bottom","offsetX":24,"offsetY":72}'
      )
    ).toEqual({
      anchorX: 'right',
      anchorY: 'bottom',
      offsetX: 24,
      offsetY: 72
    })
    expect(parseFloatingTerminalTriggerPosition('{"left":900,"top":500}')).toEqual({
      left: 900,
      top: 500
    })
  })

  it('does not clamp parsed positions before the viewport is settled', () => {
    stubViewport(0, 0)

    expect(parseFloatingTerminalTriggerPosition('{"left":900,"top":500}')).toEqual({
      left: 900,
      top: 500
    })
  })

  it('detects whether the viewport is usable for persisted user-position clamps', () => {
    stubViewport(0, 0)
    expect(hasUsableFloatingTerminalTriggerViewport()).toBe(false)

    stubViewport(1200, 800)
    expect(hasUsableFloatingTerminalTriggerViewport()).toBe(true)
  })

  it('does not derive anchors from a viewport smaller than the trigger', () => {
    stubViewport(40, 40)

    expect(anchorFloatingTerminalTriggerPosition({ left: 8, top: 36 })).toBeNull()
  })

  it('defers user-position reconciliation until the viewport is usable', () => {
    stubViewport(0, 0)

    expect(shouldReconcileFloatingTerminalTriggerPosition('default')).toBe(true)
    expect(shouldReconcileFloatingTerminalTriggerPosition('user')).toBe(false)

    stubViewport(1200, 800)
    expect(shouldReconcileFloatingTerminalTriggerPosition('user')).toBe(true)
  })

  it('reads and writes persisted positions without throwing when storage is unavailable', () => {
    const localStorage = {
      getItem: vi.fn(() => {
        throw new Error('blocked')
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked')
      })
    }
    stubViewport(1200, 800, localStorage)

    expect(readPersistedFloatingTerminalTriggerPosition()).toBeNull()
    expect(() =>
      persistFloatingTerminalTriggerPosition({
        anchorX: 'right',
        anchorY: 'bottom',
        offsetX: 24,
        offsetY: 72
      })
    ).not.toThrow()
  })

  it('persists through the trigger-specific storage key', () => {
    const localStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn()
    }
    stubViewport(1200, 800, localStorage)

    persistFloatingTerminalTriggerPosition({
      anchorX: 'right',
      anchorY: 'bottom',
      offsetX: 24,
      offsetY: 72
    })

    expect(localStorage.setItem).toHaveBeenCalledWith(
      FLOATING_TERMINAL_TRIGGER_POSITION_STORAGE_KEY,
      '{"anchorX":"right","anchorY":"bottom","offsetX":24,"offsetY":72}'
    )
  })

  it('keeps the whole dock pill inside the window at its default spot', () => {
    stubViewport(1440, 900)
    const { left, top } = getDefaultFloatingTerminalTriggerPosition()
    // The pill is w-80 (320px) by 54px; it used to be placed as if it were 36px.
    expect(left + 320).toBeLessThanOrEqual(1440)
    expect(top + 54).toBeLessThanOrEqual(900)
  })
})
