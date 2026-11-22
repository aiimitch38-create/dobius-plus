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
import {
  publishVoiceOrbPresentation,
  setAdamVoiceHangUp
} from '@/components/dictation/voice-orb-live-level'
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
  BoardThread: ({ messages }: { messages: readonly BoardThreadMessage[] }) => (
    <section aria-label="Thread">
      {messages.map((message) => (
        <p key={message.id}>{message.text}</p>
      ))}
    </section>
  )
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
  act(() => publishVoiceOrbPresentation({ state: 'idle', activitySource: 'preview' }))
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

  it('stays closed and leaves focus alone when ADAM replies or a voice row arrives', () => {
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    outside.focus()
    render(saved)
    render([...saved, fresh])
    render([
      ...saved,
      fresh,
      { id: 'spoken', role: 'user', voice: true, text: 'what is running?' },
      { id: 'spoken-reply', role: 'assistant', voice: true, text: 'Two consoles.' }
    ])
    expect(thread()).toBeNull()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('the toggle opens the full thread with its history', () => {
    render([...saved, fresh])
    toggle('Show thread')
    expect(thread()?.textContent).toContain('No running console to change.')
    expect(thread()?.textContent).toContain('Ready.')
  })

  it('opens when Carson sends a typed command himself', () => {
    const onCommand = vi.fn()
    act(() =>
      root.render(
        <TooltipProvider>
          <BoardCommandBar {...props} messages={saved} draft="run the tests" onCommand={onCommand} />
        </TooltipProvider>
      )
    )
    expect(thread()).toBeNull()
    act(() => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onCommand).toHaveBeenCalledWith('run the tests')
    expect(thread()).not.toBeNull()
  })

  it('a closed or folded thread never hangs up the live voice call', () => {
    const hangUp = vi.fn()
    const unregister = setAdamVoiceHangUp(hangUp)
    act(() => publishVoiceOrbPresentation({ state: 'listening', activitySource: 'input' }))
    render(saved)
    render([...saved, fresh])
    toggle('Show thread')
    toggle('Hide thread')
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    act(() => root.render(null))
    expect(hangUp).not.toHaveBeenCalled()
    unregister()
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

  it('stays collapsed when history is cleared and for the next message', () => {
    render(saved)
    render([])
    expect(thread()).toBeNull()
    render([fresh])
    expect(thread()).toBeNull()
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

describe('BoardCommandBar status', () => {
  const status = (): string => container.querySelector('[role="status"]')?.textContent ?? ''
  const draw = (busy: boolean): void =>
    act(() =>
      root.render(
        <TooltipProvider>
          <BoardCommandBar {...props} messages={[]} busy={busy} />
        </TooltipProvider>
      )
    )

  it('shows nothing while ADAM is idle or only listening', () => {
    draw(false)
    expect(status()).toBe('')
    act(() => publishVoiceOrbPresentation({ state: 'listening', activitySource: 'input' }))
    expect(status()).toBe('')
  })

  it('shows Working while a typed command is being handled', () => {
    draw(true)
    expect(status()).toBe('Working…')
  })

  it('shows Thinking and then Speaking for the voice turn, with the thread closed', () => {
    draw(true)
    act(() => publishVoiceOrbPresentation({ state: 'thinking', activitySource: 'preview' }))
    expect(status()).toBe('Thinking…')
    act(() => publishVoiceOrbPresentation({ state: 'speaking', activitySource: 'output' }))
    expect(status()).toBe('Speaking…')
    expect(thread()).toBeNull()
    act(() => publishVoiceOrbPresentation({ state: 'idle', activitySource: 'preview' }))
    draw(false)
    expect(status()).toBe('')
  })
})
