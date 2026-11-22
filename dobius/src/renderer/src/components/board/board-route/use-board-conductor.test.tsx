// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBoardConductor, type BoardConductor } from './use-board-conductor'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
let conductor: BoardConductor

// Stands in for the main process, which owns the thread: adds a row once and tells the window.
type Row = { id: string; role: string; text: string; voice?: boolean; tone?: string }
let mainRows: Row[]
let tell: ((rows: Row[]) => void) | null
function installMain(): void {
  mainRows = []
  tell = null
  ;(window as unknown as { api: unknown }).api = {
    jarvis: {
      adamThreadGet: async () => mainRows,
      adamThreadAppend: async (row: Row) => {
        if (!mainRows.some((existing) => existing.id === row.id)) {
          mainRows = [...mainRows, row]
          tell?.(mainRows)
        }
        return { ok: true }
      },
      adamThreadClear: async () => {
        mainRows = []
        tell?.(mainRows)
        return { ok: true }
      },
      onAdamThread: (callback: (rows: Row[]) => void) => {
        tell = callback
        return () => {
          tell = null
        }
      }
    }
  }
}

function Harness(_: { project: string }): null {
  conductor = useBoardConductor()
  return null
}
// The Board route is remounted per project; the thread must not care which one.
const open = async (project: string): Promise<void> => {
  await act(async () => root.render(<Harness key={project} project={project} />))
}
const shown = (): string[] => conductor.messages.map((message) => message.text)

beforeEach(() => {
  toastError.mockClear()
  window.localStorage.clear()
  installMain()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useBoardConductor: ADAM has one thread for every project', () => {
  it('shows the same rows in every project', async () => {
    await open('project-a')
    await act(async () => conductor.append({ role: 'user', text: 'hello' }))
    await act(async () => conductor.append({ role: 'assistant', text: 'Hi.' }))
    expect(shown()).toEqual(['hello', 'Hi.'])
    await open('project-b')
    expect(shown()).toEqual(['hello', 'Hi.'])
    await act(async () => conductor.append({ role: 'user', text: 'and here?' }))
    await open('project-a')
    expect(shown()).toEqual(['hello', 'Hi.', 'and here?'])
  })

  it('never writes the thread itself: main is the only owner', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await open('project-a')
    await act(async () => conductor.append({ role: 'user', text: 'hello' }))
    expect(shown()).toEqual(['hello'])
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('shows rows another window added, keeping its own waiting row', async () => {
    await open('project-a')
    act(() => {
      conductor.showThinking('ADAM is thinking…')
    })
    await act(async () => {
      mainRows = [{ id: 'other', role: 'user', text: 'from the other window' }]
      tell?.(mainRows)
    })
    expect(shown()).toEqual(['from the other window', 'ADAM is thinking…'])
  })

  it('keeps a reply that lands after the Board was closed', async () => {
    await open('project-a')
    const append = conductor.append
    act(() => root.unmount())
    await act(async () => append({ role: 'assistant', text: 'Late reply.' }))
    root = createRoot(container)
    await open('project-b')
    expect(shown()).toEqual(['Late reply.'])
  })

  it('leaves the old per-project threads in storage and does not show them', async () => {
    const old = JSON.stringify([{ id: 'x', role: 'user', text: 'old row' }])
    window.localStorage.setItem('dobius.board.thread.v1.repo-a', old)
    await open('project-a')
    expect(shown()).toEqual([])
    expect(window.localStorage.getItem('dobius.board.thread.v1.repo-a')).toBe(old)
  })

  it('tells Carson when main could not save the thread, and still shows the row', async () => {
    await open('project-a')
    const jarvis = (window as unknown as { api: { jarvis: Record<string, unknown> } }).api.jarvis
    jarvis.adamThreadAppend = async (row: Row) => {
      mainRows = [...mainRows, row]
      tell?.(mainRows)
      return { ok: false, error: 'not-saved' }
    }
    await act(async () => conductor.append({ role: 'user', text: 'hello' }))
    expect(shown()).toEqual(['hello'])
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError.mock.calls[0][0]).toContain('could not be saved to disk')
  })

  it('clears the thread through main and never saves a thinking row', async () => {
    await open('project-a')
    await act(async () => conductor.append({ role: 'user', text: 'hello' }))
    let done: () => void = () => {}
    act(() => {
      done = conductor.showThinking('ADAM is thinking…')
    })
    expect(shown()).toEqual(['hello', 'ADAM is thinking…'])
    expect(mainRows.map((row) => row.text)).toEqual(['hello'])
    await act(async () => conductor.clearThread())
    expect(shown()).toEqual(['ADAM is thinking…'])
    act(() => done())
    expect(shown()).toEqual([])
  })
})
