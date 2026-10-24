// @vitest-environment happy-dom
import { act, createRef, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BoardCommandBar, type BoardCommandBarProps } from './BoardCommandBar'
import type { BoardThreadMessage } from './BoardThread'

vi.mock('@/components/dictation/VoiceOrb', () => ({ VoiceOrb: () => null }))
vi.mock('./BoardVoiceCaption', () => ({ BoardVoiceCaption: () => null }))
vi.mock('./BoardThread', () => ({
  BoardThread: () => <section aria-label="Thread" />
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const saved: BoardThreadMessage[] = [
  { id: 'old-error', role: 'system', tone: 'error', text: 'No running console to change.' }
]
const fresh: BoardThreadMessage = { id: 'new-reply', role: 'assistant', text: 'Ready.' }
const props: Omit<BoardCommandBarProps, 'messages'> = {
  projectName: 'dobius-plus',
  languageLabel: 'Auto',
  draft: '',
  onDraftChange: vi.fn(),
  inputRef: createRef<HTMLInputElement>(),
  onCommand: vi.fn(),
  onChip: vi.fn(),
  getVoiceLevel: () => 0,
  listening: false,
  onMicToggle: vi.fn()
}
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

function render(messages: BoardThreadMessage[]): void {
  act(() =>
    root.render(
      <StrictMode>
        <TooltipProvider>
          <BoardCommandBar {...props} messages={messages} />
        </TooltipProvider>
      </StrictMode>
    )
  )
}

function toggle(label: 'Show thread' | 'Hide thread'): void {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(button).not.toBeNull()
  act(() => button?.click())
}

const thread = (): Element | null => container.querySelector('section[aria-label="Thread"]')

describe('BoardCommandBar thread visibility', () => {
  it('starts collapsed with restored errors and still allows opening history manually', () => {
    render(saved)
    expect(thread()).toBeNull()
    toggle('Show thread')
    expect(thread()).not.toBeNull()
    toggle('Hide thread')
    expect(thread()).toBeNull()
  })

  it('opens when a fresh message arrives after history was restored', () => {
    render(saved)
    render([...saved, fresh])
    expect(thread()).not.toBeNull()
  })

  it('keeps a dismissed thread collapsed on rerenders and reopens for a new reply', () => {
    render(saved)
    render([...saved, fresh])
    toggle('Hide thread')
    render([...saved, fresh])
    expect(thread()).toBeNull()
    render([...saved, fresh, { ...fresh, id: 'next-reply' }])
    expect(thread()).not.toBeNull()
  })

  it('stays collapsed when history is cleared and opens for the next message', () => {
    render(saved)
    render([])
    expect(thread()).toBeNull()
    render([fresh])
    expect(thread()).not.toBeNull()
  })
})
