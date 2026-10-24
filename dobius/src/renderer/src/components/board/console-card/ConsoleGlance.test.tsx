// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConsoleGlance } from './ConsoleGlance'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

type Props = React.ComponentProps<typeof ConsoleGlance>
const base: Props = {
  title: 'Claude 2',
  status: 'working',
  lines: null,
  lastReply: null,
  scale: 0.3
}

function render(props: Partial<Props>): HTMLElement {
  act(() => root.render(<ConsoleGlance {...base} {...props} />))
  const glance = container.querySelector<HTMLElement>('[data-board-console-glance]')
  if (!glance) {
    throw new Error('glance not rendered')
  }
  return glance
}

describe('ConsoleGlance', () => {
  it('shows the status and the terminal tail, never an empty body', () => {
    const glance = render({ lines: ['Running tests', 'PASS 12 tests'] })
    expect(glance.textContent).toContain('Working')
    expect(glance.textContent).toContain('Running tests')
    expect(glance.textContent).toContain('PASS 12 tests')
    expect(glance.hasAttribute('data-needs-you')).toBe(false)
  })

  it('falls back to the last reply, then to an explicit empty state', () => {
    expect(render({ lines: [], lastReply: 'All done.\nOpened PR #4' }).textContent).toContain(
      'Opened PR #4'
    )
    expect(render({ lines: null, lastReply: null }).textContent).toContain('No output yet')
  })

  it('emphasizes a console that needs you', () => {
    const glance = render({ status: 'waiting', lines: ['Allow edit? (y/n)'] })
    expect(glance.hasAttribute('data-needs-you')).toBe(true)
    expect(glance.textContent).toContain('Needs you')
  })

  it('counter-scales to a fixed on-screen size and is not focusable', () => {
    const glance = render({ lines: ['x'], scale: 0.25 })
    expect(glance.style.transform).toBe('scale(4)')
    expect(glance.style.width).toBe('25%')
    expect(glance.querySelector('[tabindex], button, input')).toBeNull()
  })
})
