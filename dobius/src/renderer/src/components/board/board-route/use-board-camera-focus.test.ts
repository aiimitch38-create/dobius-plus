// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { boardArrowStep, boardEscapeExitsFocus, boardKeyTarget } from './use-board-camera-focus'

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
