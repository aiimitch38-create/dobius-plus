// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { CLEAR_TERMINAL_SELECTION_EVENT } from '@/constants/terminal'
import {
  boardArrowStep,
  boardBodyDoubleClickFocuses,
  boardEscapeExitsFocus,
  boardFocusClickCardId,
  boardFocusDoubleClickCardId,
  boardGroupTabAt,
  boardKeyTarget
} from './board-focus-targets'
import { clearConsoleTextSelection } from './use-board-camera-focus'

function inTerminal(): HTMLElement {
  const host = document.createElement('div')
  host.setAttribute('data-board-console', '')
  const textarea = document.createElement('textarea')
  textarea.className = 'xterm-helper-textarea'
  host.appendChild(textarea)
  return textarea
}

const arrow = (
  key: string,
  mods: Partial<Record<'altKey' | 'shiftKey' | 'metaKey' | 'ctrlKey', boolean>> = {}
) => ({
  key,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...mods
})

describe('focus-mode keys', () => {
  it('classifies where a key lands; terminals win over their hidden textarea', () => {
    expect(boardKeyTarget(inTerminal())).toBe('terminal')
    expect(boardKeyTarget(document.createElement('input'))).toBe('field')
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const button = document.createElement('button')
    dialog.appendChild(button)
    expect(boardKeyTarget(button)).toBe('overlay')
    expect(boardKeyTarget(document.body)).toBe('board')
  })

  it('Esc exits from the board; inside a terminal only Shift+Esc does', () => {
    expect(boardEscapeExitsFocus('board', false)).toBe(true)
    expect(boardEscapeExitsFocus('terminal', false)).toBe(false)
    expect(boardEscapeExitsFocus('terminal', true)).toBe(true)
    expect(boardEscapeExitsFocus('field', true)).toBe(true)
    expect(boardEscapeExitsFocus('overlay', true)).toBe(false)
  })

  it('⌥←/→ steps on the board; in a terminal it needs Shift so word-jump keeps working', () => {
    expect(boardArrowStep(arrow('ArrowRight', { altKey: true }), 'board')).toBe(1)
    expect(boardArrowStep(arrow('ArrowLeft', { altKey: true }), 'board')).toBe(-1)
    expect(boardArrowStep(arrow('ArrowLeft', { altKey: true }), 'terminal')).toBeNull()
    expect(boardArrowStep(arrow('ArrowLeft', { altKey: true, shiftKey: true }), 'terminal')).toBe(
      -1
    )
    expect(boardArrowStep(arrow('ArrowLeft', { altKey: true }), 'field')).toBeNull()
    expect(boardArrowStep(arrow('ArrowLeft'), 'board')).toBeNull()
    expect(boardArrowStep(arrow('ArrowUp', { altKey: true }), 'board')).toBeNull()
  })
})

describe('double-click focus clears the selection it consumed', () => {
  it('drops the DOM selection and asks that terminal to clear its own', () => {
    const p = document.createElement('p')
    p.textContent = 'some words here'
    document.body.appendChild(p)
    const range = document.createRange()
    range.selectNodeContents(p)
    window.getSelection()?.addRange(range)
    expect(window.getSelection()?.rangeCount).toBe(1)

    const heard = vi.fn()
    window.addEventListener(CLEAR_TERMINAL_SELECTION_EVENT, heard)
    clearConsoleTextSelection('tab-7')
    window.removeEventListener(CLEAR_TERMINAL_SELECTION_EVENT, heard)

    expect(window.getSelection()?.rangeCount).toBe(0)
    expect(heard).toHaveBeenCalledTimes(1)
    expect((heard.mock.calls[0][0] as CustomEvent).detail).toEqual({ tabId: 'tab-7' })
    p.remove()
  })
})

/** A card as BoardCardFrame renders it: root, title bar (unless bare), body. */
function cardDom(id: string, opts: { bare?: boolean } = {}) {
  const root = document.createElement('div')
  root.setAttribute('data-board-card', '')
  root.setAttribute('data-board-card-id', id)
  const header = document.createElement('div')
  header.setAttribute('data-board-card-header', '')
  const title = document.createElement('span')
  header.appendChild(title)
  const menu = document.createElement('button')
  menu.setAttribute('data-board-card-control', '')
  header.appendChild(menu)
  if (!opts.bare) {
    root.appendChild(header)
  }
  const body = document.createElement('div')
  root.appendChild(body)
  const inner = document.createElement('div')
  body.appendChild(inner)
  const button = document.createElement('button')
  body.appendChild(button)
  const field = document.createElement('textarea')
  body.appendChild(field)
  return { root, title, menu, body: inner, button, field }
}

describe('what triggers focus', () => {
  it('a single click on any card title focuses it; body, controls and fields do not', () => {
    const card = cardDom('note-1')
    expect(boardFocusClickCardId(card.title)).toBe('note-1')
    expect(boardFocusClickCardId(card.menu)).toBeNull()
    expect(boardFocusClickCardId(card.body)).toBeNull()
    expect(boardFocusClickCardId(card.field)).toBeNull()
    // Bare cards (text, shape, image) have no title bar: a body click only selects.
    const bare = cardDom('img-1', { bare: true })
    expect(boardFocusClickCardId(bare.body)).toBeNull()
  })

  it("a console's zoomed-out glance focuses on a single click", () => {
    const card = cardDom('con-1')
    const glance = document.createElement('div')
    glance.setAttribute('data-board-console-glance', '')
    card.body.appendChild(glance)
    expect(boardFocusClickCardId(glance)).toBe('con-1')
  })

  it('body double-click focuses only kinds with no double-click of their own', () => {
    for (const k of [
      'console',
      'image',
      'calendar',
      'checklist',
      'branches',
      'orchestrator',
      'memory',
      'skill'
    ]) {
      expect(boardBodyDoubleClickFocuses(k)).toBe(true)
    }
    for (const k of ['text', 'shape', 'note', 'kanban', 'web', 'markdown', 'stroke', undefined]) {
      expect(boardBodyDoubleClickFocuses(k)).toBe(false)
    }
  })

  it('maps a double-click target to the card it focuses, leaving inputs and editors alone', () => {
    const kinds: Record<string, string> = {
      img: 'image',
      cal: 'calendar',
      note: 'note',
      text: 'text',
      shape: 'shape',
      web: 'web',
      con: 'console'
    }
    const kindOf = (id: string): string | undefined => kinds[id]
    expect(boardFocusDoubleClickCardId(cardDom('img', { bare: true }).body, kindOf)).toBe('img')
    const cal = cardDom('cal')
    expect(boardFocusDoubleClickCardId(cal.body, kindOf)).toBe('cal')
    expect(boardFocusDoubleClickCardId(cal.button, kindOf)).toBeNull()
    expect(boardFocusDoubleClickCardId(cal.title, kindOf)).toBeNull()
    expect(boardFocusDoubleClickCardId(cardDom('note').body, kindOf)).toBeNull()
    expect(boardFocusDoubleClickCardId(cardDom('text', { bare: true }).body, kindOf)).toBeNull()
    expect(boardFocusDoubleClickCardId(cardDom('shape', { bare: true }).body, kindOf)).toBeNull()
    expect(boardFocusDoubleClickCardId(cardDom('web').body, kindOf)).toBeNull()
    // Consoles: the terminal body (its hidden textarea included) focuses, the rest does not.
    const con = cardDom('con')
    expect(boardFocusDoubleClickCardId(con.body, kindOf)).toBeNull()
    const term = inTerminal()
    con.body.appendChild(term.parentElement!)
    expect(boardFocusDoubleClickCardId(term, kindOf)).toBe('con')
    expect(boardFocusDoubleClickCardId(document.body, kindOf)).toBeNull()
  })

  it("a click on a group's name tab (the frame's top edge) finds that group", () => {
    const cards = [
      { id: 'a', x: 0, y: 0, w: 300, h: 200 },
      { id: 'b', x: 400, y: 0, w: 300, h: 200 },
      { id: 'c', x: 0, y: 1000, w: 300, h: 200 }
    ]
    const groups = [
      { id: 'g1', cardIds: ['a', 'b'] },
      { id: 'g2', cardIds: ['c'] }
    ]
    // Frame top = -24 (24px padding); the tab straddles it from the left.
    expect(boardGroupTabAt({ x: 40, y: -24 }, groups, cards)).toBe('g1')
    expect(boardGroupTabAt({ x: 40, y: -10 }, groups, cards)).toBe('g1')
    expect(boardGroupTabAt({ x: 40, y: 976 }, groups, cards)).toBe('g2')
    expect(boardGroupTabAt({ x: 40, y: 100 }, groups, cards)).toBeNull()
    expect(boardGroupTabAt({ x: 2000, y: -24 }, groups, cards)).toBeNull()
  })

  it('⌥⇧←/→ inside a text field stays word selection, not a focus step', () => {
    expect(boardArrowStep(arrow('ArrowLeft', { altKey: true, shiftKey: true }), 'field')).toBeNull()
  })
})
