// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentsPageHeader, CrewControlUnreadableNotice } from './AgentsPageHeader'

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

function toggleButton(): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((node) =>
    /crew/.test(node.textContent ?? '')
  )
  if (!button) {
    throw new Error('crew toggle button not rendered')
  }
  return button
}

function renderHeader(paused: boolean, resumeBlocked: boolean, onTogglePaused = vi.fn()): void {
  act(() => {
    root.render(
      <AgentsPageHeader
        agentCount={1}
        paused={paused}
        resumeBlocked={resumeBlocked}
        pingStatus={null}
        onTogglePaused={onTogglePaused}
      />
    )
  })
}

describe('AgentsPageHeader crew toggle', () => {
  it('disables Resume while the crew control file is unreadable', () => {
    const onTogglePaused = vi.fn()
    renderHeader(true, true, onTogglePaused)
    const button = toggleButton()
    expect(button.textContent).toContain('Resume crew')
    expect(button.disabled).toBe(true)
    act(() => button.click())
    expect(onTogglePaused).not.toHaveBeenCalled()
  })

  it('keeps Resume usable for an ordinary pause', () => {
    renderHeader(true, false)
    expect(toggleButton().disabled).toBe(false)
  })

  it('keeps Pause usable', () => {
    renderHeader(false, true)
    const button = toggleButton()
    expect(button.textContent).toContain('Pause crew')
    expect(button.disabled).toBe(false)
  })
})

describe('CrewControlUnreadableNotice', () => {
  it('names the unreadable file and the reason', () => {
    act(() => {
      root.render(
        <CrewControlUnreadableNotice
          state={{
            paused: true,
            status: 'unreadable',
            filePath: '/data/agents-config.json',
            detail: 'EACCES'
          }}
        />
      )
    })
    expect(container.textContent).toContain('/data/agents-config.json')
    expect(container.textContent).toContain('EACCES')
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('renders nothing for an ordinary pause', () => {
    act(() => {
      root.render(
        <CrewControlUnreadableNotice
          state={{ paused: true, status: 'ok', filePath: '/data/agents-config.json', detail: null }}
        />
      )
    })
    expect(container.textContent).toBe('')
  })
})
