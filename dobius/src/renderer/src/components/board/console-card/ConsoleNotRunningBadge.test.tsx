// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../../../i18n/locales/en.json'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Why: read the shipped English catalog so a locale value like "Done" fails here.
function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
  }, en)
}
vi.mock('@/i18n/i18n', () => ({
  translate: (key: string, fallback: string, vars?: Record<string, string>) => {
    const value = lookup(key)
    const text = typeof value === 'string' ? value : fallback
    return text.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => vars?.[name] ?? '')
  }
}))
const confirm = vi.fn()
vi.mock('@/components/confirmation-dialog', () => ({ useConfirmationDialog: () => confirm }))
const restartConsoleConfirmed = vi.fn()
vi.mock('./console-actions', () => ({
  restartConsoleConfirmed: (...args: unknown[]) => restartConsoleConfirmed(...args)
}))

const { ConsoleNotRunningBadge } = await import('./ConsoleNotRunningBadge')
const { CONSOLE_STATUS_DOT, consoleStatusLabel } = await import('./console-card-status')

const card = {
  id: 'card-1',
  kind: 'console' as const,
  tabId: 'tab-1',
  title: 'Builder 1',
  agentKind: 'claude',
  x: 0,
  y: 0,
  w: 400,
  h: 300,
  z: 1
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  restartConsoleConfirmed.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = (status: Parameters<typeof ConsoleNotRunningBadge>[0]['status']): void => {
  act(() => root.render(<ConsoleNotRunningBadge worktreeId="wt-1" card={card} status={status} />))
}

describe('ConsoleNotRunningBadge', () => {
  it.each(['done', 'gone'] as const)(
    'shows "Not running" and a Restart button when the terminal is %s',
    (status) => {
      render(status)
      expect(container.querySelector('[data-board-console-not-running]')?.textContent).toBe(
        'Not running'
      )
      const button = container.querySelector('button')
      expect(button?.getAttribute('aria-label')).toBe('Restart Builder 1')
      act(() => button?.click())
      expect(restartConsoleConfirmed).toHaveBeenCalledWith('wt-1', card, confirm)
    }
  )

  it.each(['working', 'waiting', 'idle', 'paused', 'shell'] as const)(
    'renders nothing while the terminal is running (%s)',
    (status) => {
      render(status)
      expect(container.innerHTML).toBe('')
    }
  )
})

describe('exited console label', () => {
  it('says "Exited", not "Done", for a process that ended (orchestrator rows use this)', () => {
    expect(consoleStatusLabel('done')).toBe('Exited')
  })

  it('does not draw the success-colored "Done" dot for an exited console', () => {
    expect(CONSOLE_STATUS_DOT.done).toBeUndefined()
  })
})
