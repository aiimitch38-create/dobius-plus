import { describe, expect, it } from 'vitest'
import { focusMovedOutOfMenu } from './card-menu-focus'

const body = {} as Element
const item = {} as Element
const input = {} as Element
const content = { contains: (n: Node | null) => (n as unknown) === item }

describe('focusMovedOutOfMenu', () => {
  it('keeps focus that an action moved to a field outside the menu', () => {
    expect(focusMovedOutOfMenu(input, body, content)).toBe(true)
  })

  it('restores when focus fell back to the body', () => {
    expect(focusMovedOutOfMenu(body, body, content)).toBe(false)
  })

  it('restores when focus is still inside the menu', () => {
    expect(focusMovedOutOfMenu(item, body, content)).toBe(false)
  })

  it('restores when nothing is focused', () => {
    expect(focusMovedOutOfMenu(null, body, content)).toBe(false)
  })
})
