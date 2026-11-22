// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { boardThreadStorageKey, deserializeBoardThread } from './board-thread-persistence'
import { useBoardConductor, type BoardConductor } from './use-board-conductor'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
let conductor: BoardConductor

function Harness({ repoId }: { repoId: string }): null {
  conductor = useBoardConductor(repoId)
  return null
}
const open = (repoId: string): void => act(() => root.render(<Harness repoId={repoId} />))
const stored = (repoId: string): string[] =>
  deserializeBoardThread(window.localStorage.getItem(boardThreadStorageKey(repoId))).map(
    (message) => message.text
  )
const shown = (): string[] => conductor.messages.map((message) => message.text)

beforeEach(() => {
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useBoardConductor: rows go to the thread they belong to', () => {
  it('appends to the thread on screen when that is the target', () => {
    open('repo-a')
    act(() => conductor.appendTo('repo-a', { role: 'assistant', text: 'Hi.' }))
    expect(shown()).toEqual(['Hi.'])
    expect(stored('repo-a')).toEqual(['Hi.'])
  })

  it('saves a reply for another repo to that repo, not the thread on screen', () => {
    open('repo-a')
    act(() => conductor.appendTo('repo-a', { role: 'user', text: 'hello' }))
    open('repo-b')
    act(() => conductor.appendTo('repo-a', { role: 'assistant', text: 'Late reply.' }))
    expect(shown()).toEqual([])
    expect(stored('repo-b')).toEqual([])
    expect(stored('repo-a')).toEqual(['hello', 'Late reply.'])
    open('repo-a')
    expect(shown()).toEqual(['hello', 'Late reply.'])
  })

  it('keeps a thinking row with its own repo and never saves it', () => {
    open('repo-a')
    let done: () => void = () => {}
    act(() => {
      done = conductor.showThinkingIn('repo-a', 'ADAM is thinking…')
    })
    expect(shown()).toEqual(['ADAM is thinking…'])
    expect(stored('repo-a')).toEqual([])
    open('repo-b')
    expect(shown()).toEqual([])
    open('repo-a')
    expect(shown()).toEqual(['ADAM is thinking…'])
    open('repo-b')
    act(() => done())
    open('repo-a')
    expect(shown()).toEqual([])
  })
})
