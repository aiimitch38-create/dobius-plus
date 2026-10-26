// ONE host-DOM layer above the cards: agent pointers, hover outlines, click
// ripples and off-screen hints. It never takes pointer events. Positions are
// written straight to the DOM each animation frame (the camera pans under the
// tiles, so a tile-relative pointer must be re-projected continuously).
import React, { useEffect, useRef } from 'react'
import type { AgentCursorTarget } from '../../../../../shared/agent-cursor'
import { prefersReducedMotion } from '../board-canvas/board-camera'
import { AgentCursor, AgentEdgeHint } from './AgentCursor'
import { clampToEdge, projectAgentTarget } from './agent-cursor-mapping'
import { startAgentPresence, useAgentPresence, type AgentPresence } from './agent-presence-state'
import { CursorInterpolator } from './cursor-interpolator'
import { installConsoleDriverNames } from '../board-browser-link/console-driver-names'

const RIPPLE_SIZE_PX = 44
const HOVER_OUTLINE_OFFSET_PX = 2

type Handle = {
  interpolator: CursorInterpolator
  space: string | null
  lastPointer: AgentCursorTarget | null
  cursorEl: HTMLDivElement | null
  hintEl: HTMLDivElement | null
  hoverEl: HTMLDivElement | null
  rippleEl: HTMLDivElement | null
}

function spaceOf(target: AgentCursorTarget): string {
  return 'window' in target ? 'window' : target.tileId
}

function hide(el: HTMLElement | null): void {
  if (el) {
    el.style.visibility = 'hidden'
  }
}

function place(el: HTMLElement | null, x: number, y: number, extra?: string): void {
  if (el) {
    el.style.visibility = 'visible'
    el.style.transform = `translate(${x}px, ${y}px)${extra ?? ''}`
  }
}

function visiblePointer(agent: AgentPresence): boolean {
  return agent.pointer !== null && !agent.stopped && agent.userState !== 'away'
}

function newHandle(): Handle {
  return {
    interpolator: new CursorInterpolator(prefersReducedMotion()),
    space: null,
    lastPointer: null,
    cursorEl: null,
    hintEl: null,
    hoverEl: null,
    rippleEl: null
  }
}

export function AgentCursorLayer(): React.JSX.Element {
  const agents = useAgentPresence((s) => s.agents)
  const layerRef = useRef<HTMLDivElement>(null)
  const handles = useRef(new Map<string, Handle>())
  const handleFor = (id: string): Handle => {
    let handle = handles.current.get(id)
    if (!handle) {
      handle = newHandle()
      handles.current.set(id, handle)
    }
    return handle
  }

  useEffect(() => startAgentPresence(), [])
  useEffect(() => installConsoleDriverNames(), [])

  // Why: the frame loop costs a getBoundingClientRect per frame, so it runs only
  // while some agent has a pointer to draw and stops itself when none is left.
  const loop = useRef<{ frameId: number; running: boolean; start: () => void }>({
    frameId: 0,
    running: false,
    start: () => {}
  })

  // Feed new pointer targets to each agent's interpolator; a new tile resets it.
  useEffect(() => {
    const reduced = prefersReducedMotion()
    if (Object.values(agents).some(visiblePointer)) {
      loop.current.start()
    }
    for (const agent of Object.values(agents)) {
      const handle = handleFor(agent.id)
      const pointer = agent.pointer
      if (!pointer || pointer === handle.lastPointer) {
        continue
      }
      handle.lastPointer = pointer
      const space = spaceOf(pointer)
      if (space !== handle.space) {
        handle.interpolator.dispose()
        handle.interpolator = new CursorInterpolator(reduced)
        handle.space = space
      }
      handle.interpolator.setTarget(pointer.x, pointer.y)
    }
    for (const [id, handle] of handles.current) {
      if (!agents[id]) {
        handle.interpolator.dispose()
        handles.current.delete(id)
      }
    }
  }, [agents])

  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') {
      return
    }
    const state = loop.current
    let last = performance.now()
    const frame = (now: number): void => {
      const dt = now - last
      last = now
      const current = useAgentPresence.getState().agents
      if (!Object.values(current).some(visiblePointer)) {
        for (const handle of handles.current.values()) {
          hide(handle.cursorEl)
          hide(handle.hintEl)
          hide(handle.hoverEl)
          hide(handle.rippleEl)
        }
        state.running = false
        return
      }
      const layer = layerRef.current
      const bounds = layer?.getBoundingClientRect()
      for (const [id, handle] of handles.current) {
        const agent = current[id]
        const point = handle.interpolator.current
        if (!agent || !bounds || !point || !agent.pointer || !visiblePointer(agent)) {
          hide(handle.cursorEl)
          hide(handle.hintEl)
          hide(handle.hoverEl)
          hide(handle.rippleEl)
          continue
        }
        handle.interpolator.tick(dt)
        const screen = projectAgentTarget(agent.pointer, point)
        if (!screen) {
          hide(handle.cursorEl)
          hide(handle.hintEl)
          hide(handle.hoverEl)
          hide(handle.rippleEl)
          continue
        }
        const local = { x: screen.x - bounds.left, y: screen.y - bounds.top }
        const hint = clampToEdge(local, {
          left: 0,
          top: 0,
          width: bounds.width,
          height: bounds.height
        })
        if (hint.offscreen) {
          hide(handle.cursorEl)
          place(handle.hintEl, hint.x, hint.y)
          const arrow = handle.hintEl?.querySelector('svg')
          if (arrow) {
            arrow.style.transform = `rotate(${hint.angleDeg}deg)`
          }
        } else {
          hide(handle.hintEl)
          place(handle.cursorEl, local.x, local.y)
        }
        const hover = agent.hover ? projectAgentTarget(agent.hover) : null
        if (hover && handle.hoverEl && (hover.w > 0 || hover.h > 0)) {
          const el = handle.hoverEl
          el.style.width = `${hover.w + HOVER_OUTLINE_OFFSET_PX * 2}px`
          el.style.height = `${hover.h + HOVER_OUTLINE_OFFSET_PX * 2}px`
          place(
            el,
            hover.x - bounds.left - HOVER_OUTLINE_OFFSET_PX,
            hover.y - bounds.top - HOVER_OUTLINE_OFFSET_PX
          )
        } else {
          hide(handle.hoverEl)
        }
        const ripple = agent.ripple ? projectAgentTarget(agent.ripple.target) : null
        if (ripple) {
          place(handle.rippleEl, ripple.x - bounds.left, ripple.y - bounds.top)
        } else {
          hide(handle.rippleEl)
        }
      }
      state.frameId = requestAnimationFrame(frame)
    }
    state.start = () => {
      if (!state.running) {
        state.running = true
        last = performance.now()
        state.frameId = requestAnimationFrame(frame)
      }
    }
    if (Object.values(useAgentPresence.getState().agents).some(visiblePointer)) {
      state.start()
    }
    return () => {
      cancelAnimationFrame(state.frameId)
      state.running = false
      state.start = () => {}
    }
  }, [])

  const bind =
    (id: string, key: 'cursorEl' | 'hintEl' | 'hoverEl' | 'rippleEl') =>
    (el: HTMLDivElement | null): void => {
      handleFor(id)[key] = el
    }

  return (
    <div
      ref={layerRef}
      data-agent-cursor-layer
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
    >
      {Object.values(agents)
        .filter(visiblePointer)
        .map((agent) => (
          <React.Fragment key={agent.id}>
            <div
              ref={bind(agent.id, 'hoverEl')}
              data-agent-hover={agent.id}
              className="absolute top-0 left-0 rounded-[4px] border-2"
              style={{
                visibility: 'hidden',
                borderColor: agent.color,
                background: `color-mix(in oklch, ${agent.color} 24%, transparent)`
              }}
            />
            {agent.ripple ? (
              <div
                key={agent.ripple.seq}
                ref={bind(agent.id, 'rippleEl')}
                className="absolute top-0 left-0"
                style={{ visibility: 'hidden' }}
              >
                <div
                  data-agent-ripple={agent.ripple.kind}
                  className="rounded-full border-2"
                  style={{
                    width: RIPPLE_SIZE_PX,
                    height: RIPPLE_SIZE_PX,
                    marginLeft: -RIPPLE_SIZE_PX / 2,
                    marginTop: -RIPPLE_SIZE_PX / 2,
                    borderColor: agent.color
                  }}
                />
              </div>
            ) : null}
            <div
              ref={bind(agent.id, 'cursorEl')}
              data-agent-id={agent.id}
              className="absolute top-0 left-0 will-change-transform"
              style={{ visibility: 'hidden', color: agent.color }}
            >
              <AgentCursor agent={agent} />
            </div>
            <div
              ref={bind(agent.id, 'hintEl')}
              data-agent-hint-for={agent.id}
              className="absolute top-0 left-0"
              style={{ visibility: 'hidden' }}
            >
              <AgentEdgeHint agent={agent} angleDeg={0} />
            </div>
          </React.Fragment>
        ))}
    </div>
  )
}
