// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { isBoardShortcutBlockedTarget } from './board-tools'

function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

describe('isBoardShortcutBlockedTarget', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('allows the canvas and plain chrome buttons', () => {
    const root = mount('<div data-board-canvas><button id="b">x</button></div>')
    expect(isBoardShortcutBlockedTarget(root.querySelector('[data-board-canvas]'))).toBe(false)
    expect(isBoardShortcutBlockedTarget(root.querySelector('#b'))).toBe(false)
    expect(isBoardShortcutBlockedTarget(null)).toBe(false)
  })

  it('blocks text fields, editable regions and selects', () => {
    const root = mount(
      '<input id="i"/><textarea id="t"></textarea><select id="s"></select><div id="c" contenteditable="true"><span id="cs">x</span></div>'
    )
    for (const id of ['i', 't', 's', 'c', 'cs']) {
      expect(isBoardShortcutBlockedTarget(root.querySelector(`#${id}`))).toBe(true)
    }
  })

  it('blocks anything inside a console card or terminal', () => {
    const root = mount(
      '<div data-board-console><div id="inner"></div></div><div class="xterm"><textarea class="xterm-helper-textarea" id="x"></textarea></div>'
    )
    expect(isBoardShortcutBlockedTarget(root.querySelector('#inner'))).toBe(true)
    expect(isBoardShortcutBlockedTarget(root.querySelector('#x'))).toBe(true)
  })

  it('blocks keys aimed at studios (dialogs) and open menus', () => {
    const root = mount(
      '<div role="dialog"><button id="d">ok</button></div><div role="menu"><div id="m" role="menuitem">a</div></div>'
    )
    expect(isBoardShortcutBlockedTarget(root.querySelector('#d'))).toBe(true)
    expect(isBoardShortcutBlockedTarget(root.querySelector('#m'))).toBe(true)
  })
})
