// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADAM_THREAD_STORAGE_KEY, deserializeBoardThread } from './board-thread-persistence'
import { useBoardConductor, type BoardConductor } from './use-board-conductor'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
let conductor: BoardConductor

function Harness(_: { project: string }): null {
  conductor = useBoardConductor()
  return null
}
// The Board route is remounted per project; the thread must not care which one.
const open = (project: string): void =>
  act(() => root.render(<Harness key={project} project={project} />))
const stored = (): string[] =>
  deserializeBoardThread(window.localStorage.getItem(ADAM_THREAD_STORAGE_KEY)).map(
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

describe('useBoardConductor: ADAM has one thread for every project', () => {
  it('shows the same rows in every project', () => {
    open('project-a')
    act(() => conductor.append({ role: 'user', text: 'hello' }))
    act(() => conductor.append({ role: 'assistant', text: 'Hi.' }))
    expect(shown()).toEqual(['hello', 'Hi.'])
    open('project-b')
    expect(shown()).toEqual(['hello', 'Hi.'])
    act(() => conductor.append({ role: 'user', text: 'and here?' }))
    open('project-a')
    expect(shown()).toEqual(['hello', 'Hi.', 'and here?'])
    expect(stored()).toEqual(['hello', 'Hi.', 'and here?'])
  })

  it('keeps a reply that lands after the Board was closed', () => {
    open('project-a')
    const append = conductor.append
    act(() => root.unmount())
    append({ role: 'assistant', text: 'Late reply.' })
    root = createRoot(container)
    open('project-b')
    expect(shown()).toEqual(['Late reply.'])
  })

  it('leaves the old per-project threads in storage and does not show them', () => {
    const old = JSON.stringify([{ id: 'x', role: 'user', text: 'old row' }])
    window.localStorage.setItem('dobius.board.thread.v1.repo-a', old)
    open('project-a')
    expect(shown()).toEqual([])
    expect(window.localStorage.getItem('dobius.board.thread.v1.repo-a')).toBe(old)
  })

  it('picks up rows another window added, keeping its own waiting row', () => {
    open('project-a')
    act(() => {
      conductor.showThinking('ADAM is thinking…')
    })
    window.localStorage.setItem(
      ADAM_THREAD_STORAGE_KEY,
      JSON.stringify([{ id: 'other', role: 'user', text: 'from the other window' }])
    )
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: ADAM_THREAD_STORAGE_KEY }))
    })
    expect(shown()).toEqual(['from the other window', 'ADAM is thinking…'])
  })

  it('never saves a thinking row', () => {
    open('project-a')
    let done: () => void = () => {}
    act(() => {
      done = conductor.showThinking('ADAM is thinking…')
    })
    expect(shown()).toEqual(['ADAM is thinking…'])
    expect(stored()).toEqual([])
    act(() => done())
    expect(shown()).toEqual([])
  })
})
