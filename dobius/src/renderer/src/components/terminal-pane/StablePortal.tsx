import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SYNC_FIT_PANES_EVENT } from '@/constants/terminal'

const CONTENTS_STYLE: React.CSSProperties = { display: 'contents' }

/**
 * Renders children into one persistent host element and MOVES that element
 * between `target` (when set) and an in-place anchor (when null).
 *
 * Why: switching between `createPortal(pane, target)` and a bare `pane`
 * changes the fiber type, so React unmounts and remounts the subtree on every
 * swap. For a TerminalPane that remount re-runs detach/reattach and could kill
 * the live agent PTY: leaving a workspace's Board and coming back wiped every
 * console card's agent session. Moving a DOM node never remounts React.
 */
export function StablePortal({
  target,
  children
}: {
  target: HTMLElement | null
  children: React.ReactNode
}): React.JSX.Element {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [host] = useState(() => {
    const el = document.createElement('div')
    el.style.display = 'contents'
    return el
  })
  // Why: mount children only once the host is in the document, so xterm's
  // first measure sees a real box instead of a detached 0x0 node.
  const [attached, setAttached] = useState(false)

  useLayoutEffect(() => {
    const parent = target ?? anchorRef.current
    if (parent && host.parentElement !== parent) {
      parent.appendChild(host)
      // Why: the pane's box changed size with its new parent; re-fit xterm.
      window.dispatchEvent(new Event(SYNC_FIT_PANES_EVENT))
    }
    setAttached(true)
  }, [host, target])

  useLayoutEffect(() => () => host.remove(), [host])

  return (
    <div ref={anchorRef} style={CONTENTS_STYLE}>
      {attached ? createPortal(children, host) : null}
    </div>
  )
}
