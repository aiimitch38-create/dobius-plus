// @vitest-environment happy-dom
import { act, createRef, StrictMode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BoardCommandBar, type BoardCommandBarProps } from './BoardCommandBar'
import type { BoardThreadMessage } from './BoardThread'

const character = vi.hoisted(() => ({ render: vi.fn() }))
vi.mock('@/components/dictation/VoiceOrb', () => ({
  VoiceOrb: (props: { size: number; getLevel: () => number }) => {
    character.render(props)
    return <div data-composer-character />
  }
}))
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

function render(messages: BoardThreadMessage[], overlay?: React.ReactNode): void {
  act(() =>
    root.render(
      <StrictMode>
        <TooltipProvider>
          <BoardCommandBar {...props} messages={messages} />
          {overlay}
        </TooltipProvider>
      </StrictMode>
    )
  )
}

// A real key press: it starts at the focused element and travels the whole document.
function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  act(() => {
    ;(document.activeElement ?? document.body).dispatchEvent(event)
  })
  return event
}

function toggle(label: 'Show thread' | 'Hide thread'): void {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(button).not.toBeNull()
  act(() => button?.click())
}

const thread = (): Element | null => container.querySelector('section[aria-label="Thread"]')

describe('BoardCommandBar thread visibility', () => {
  it('keeps one composer character on the supplied shared voice meter', () => {
    render([])
    expect(character.render.mock.lastCall![0]).toMatchObject({
      size: 60,
      getLevel: props.getVoiceLevel
    })
    expect(container.querySelectorAll('[data-composer-character]')).toHaveLength(1)
  })

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

  it('Escape folds the open thread, but not while a menu is stacked on it', () => {
    render(saved)
    toggle('Show thread')
    expect(thread()).not.toBeNull()
    const menu = document.createElement('div')
    menu.setAttribute('data-radix-popper-content-wrapper', '')
    document.body.appendChild(menu)
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(thread()).not.toBeNull()
    menu.remove()
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(thread()).toBeNull()
  })

  // Why a stand-in: in the app React removes a dismissed Radix layer between
  // the capture and bubble phases of the same key press. A dispatched test
  // event never yields in between, so the removal is done by hand here.
  it('leaves the thread open when the layer on top is gone before the key bubbles', () => {
    render(saved)
    toggle('Show thread')
    const layer = document.createElement('div')
    layer.setAttribute('role', 'dialog')
    document.body.appendChild(layer)
    const dismiss = (): void => layer.remove()
    document.addEventListener('keydown', dismiss, { capture: true })
    pressEscape()
    document.removeEventListener('keydown', dismiss, { capture: true })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(thread()).not.toBeNull()

    pressEscape()
    expect(thread()).toBeNull()
  })

  it('one Escape closes a real open menu and leaves the thread open', () => {
    const onOpenChange = vi.fn()
    render(
      saved,
      <DropdownMenu open modal={false} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Accounts</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    toggle('Show thread')
    expect(document.querySelector('[role="menu"]')).not.toBeNull()

    pressEscape()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(thread()).not.toBeNull()

    // The menu is gone now, so the next Escape is the thread's.
    render(saved)
    expect(document.querySelector('[role="menu"]')).toBeNull()
    pressEscape()
    expect(thread()).toBeNull()
  })

  it('one Escape closes a real open dialog and leaves the thread open', () => {
    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(true)
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Browse code</DialogTitle>
          </DialogContent>
        </Dialog>
      )
    }
    render(saved, <Harness />)
    toggle('Show thread')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    pressEscape()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(thread()).not.toBeNull()

    pressEscape()
    expect(thread()).toBeNull()
  })

  it('leaves the thread open when something else already took the Escape', () => {
    render(saved)
    toggle('Show thread')
    const claim = (event: KeyboardEvent): void => event.preventDefault()
    document.addEventListener('keydown', claim)
    const event = pressEscape()
    document.removeEventListener('keydown', claim)
    expect(event.defaultPrevented).toBe(true)
    expect(thread()).not.toBeNull()
  })

  it('removes every key listener it added, with the same capture flag', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const capture = (options: unknown): boolean =>
      typeof options === 'boolean'
        ? options
        : Boolean((options as AddEventListenerOptions)?.capture)
    render(saved)
    toggle('Show thread')
    toggle('Hide thread')
    act(() => root.render(null))
    const added = add.mock.calls.filter(([type]) => type === 'keydown')
    const removed = remove.mock.calls.filter(([type]) => type === 'keydown')
    expect(added.some(([, , options]) => capture(options))).toBe(true)
    for (const [, listener, options] of added) {
      expect(
        removed.some(([, gone, opts]) => gone === listener && capture(opts) === capture(options))
      ).toBe(true)
    }
    add.mockRestore()
    remove.mockRestore()
  })

  it('stays collapsed when history is cleared and opens for the next message', () => {
    render(saved)
    render([])
    expect(thread()).toBeNull()
    render([fresh])
    expect(thread()).not.toBeNull()
  })
  it('while ADAM is busy, holds a chat message but still sends an "@Name" order', () => {
    const onCommand = vi.fn()
    const draw = (draft: string): void =>
      act(() =>
        root.render(
          <TooltipProvider>
            <BoardCommandBar {...props} messages={[]} busy draft={draft} onCommand={onCommand} />
          </TooltipProvider>
        )
      )
    const send = (): HTMLButtonElement => container.querySelector('button[type="submit"]')!
    const submit = (): void =>
      act(() => {
        container.querySelector('form')!.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        )
      })
    draw('what is running?')
    expect(send().disabled).toBe(true)
    submit()
    expect(onCommand).not.toHaveBeenCalled()
    draw('@Codex 1 run the tests')
    expect(send().disabled).toBe(false)
    submit()
    expect(onCommand).toHaveBeenCalledWith('@Codex 1 run the tests')
  })
})
