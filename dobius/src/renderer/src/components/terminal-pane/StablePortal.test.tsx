// @vitest-environment happy-dom

import { act, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { StablePortal } from './StablePortal'

let mounts = 0
let unmounts = 0
function Probe(): React.JSX.Element {
  useEffect(() => {
    mounts += 1
    return () => {
      unmounts += 1
    }
  }, [])
  return <span data-testid="probe">pane</span>
}

let root: Root | null = null
let container: HTMLDivElement
function render(node: React.ReactNode): void {
  act(() => root!.render(node))
}
function setup(): HTMLDivElement {
  mounts = 0
  unmounts = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const boardTarget = document.createElement('div')
  document.body.appendChild(boardTarget)
  return boardTarget
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe('StablePortal', () => {
  it('moves the pane between in-place and the Board target without remounting it', () => {
    const boardTarget = setup()

    render(<StablePortal target={null}><Probe /></StablePortal>)
    expect(container.querySelector('[data-testid="probe"]')).not.toBeNull()

    render(<StablePortal target={boardTarget}><Probe /></StablePortal>)
    expect(boardTarget.querySelector('[data-testid="probe"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="probe"]')).toBeNull()

    render(<StablePortal target={null}><Probe /></StablePortal>)
    expect(container.querySelector('[data-testid="probe"]')).not.toBeNull()

    expect(mounts).toBe(1)
    expect(unmounts).toBe(0)
  })

  it('control: the old portal-or-bare switch remounts on every swap (the wipe bug)', () => {
    const boardTarget = setup()
    const old = (target: HTMLElement | null): React.ReactNode =>
      target ? createPortal(<Probe key="p" />, target, 'p') : <Probe key="p" />

    render(old(null))
    render(old(boardTarget))
    render(old(null))

    expect(mounts).toBe(3)
    expect(unmounts).toBe(2)
  })
})
