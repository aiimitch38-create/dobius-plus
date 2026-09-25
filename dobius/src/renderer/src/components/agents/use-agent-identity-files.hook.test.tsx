// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentReadableFiles } from '../../../../shared/agents'
import { DEFAULT_AGENT_FILES } from './agent-default-files'
import { useAgentIdentityFiles } from './use-agent-identity-files'

type HookState = ReturnType<typeof useAgentIdentityFiles>

let container: HTMLDivElement
let root: Root
let hook: HookState | null = null
const loaded: AgentReadableFiles = { ...DEFAULT_AGENT_FILES, memory: '- Old fact.\n' }
const readFiles = vi.fn()
const writeFile = vi.fn()

function Probe(props: { agentId: string | null }): null {
  hook = useAgentIdentityFiles(props.agentId)
  return null
}

function current(): HookState {
  if (!hook) {
    throw new Error('hook not rendered')
  }
  return hook
}

beforeEach(() => {
  readFiles.mockReset().mockResolvedValue(loaded)
  writeFile.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { agents: { readFiles, writeFile } }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('useAgentIdentityFiles save (#40)', () => {
  it('refuses to save an existing agent before its files have loaded', async () => {
    readFiles.mockReturnValue(new Promise(() => {}))
    await act(async () => root.render(<Probe agentId="a1" />))
    await expect(current().saveAgentFiles('a1')).rejects.toThrow(/not loaded/)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('saves a persona edit without resubmitting memory, guarded by the loaded copy', async () => {
    await act(async () => root.render(<Probe agentId="a1" />))
    await act(async () => current().setAgentFiles({ ...current().agentFiles, soul: 'Calm.\n' }))
    await act(async () => current().saveAgentFiles('a1'))
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith('a1', 'soul', 'Calm.\n', loaded.soul)
  })

  it('does not rewrite already-saved files when retrying after a conflict', async () => {
    writeFile.mockImplementation(async (_id: string, name: string) => {
      if (name === 'memory') {
        throw new Error('AGENT_FILE_CONFLICT: memory.md')
      }
    })
    await act(async () => root.render(<Probe agentId="a1" />))
    await act(async () =>
      current().setAgentFiles({ ...current().agentFiles, soul: 'Calm.\n', memory: 'M\n' })
    )
    await act(async () => {
      await expect(current().saveAgentFiles('a1')).rejects.toThrow(/AGENT_FILE_CONFLICT/)
    })
    writeFile.mockClear()
    await act(async () => {
      await expect(current().saveAgentFiles('a1')).rejects.toThrow(/AGENT_FILE_CONFLICT/)
    })
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith('a1', 'memory', 'M\n', loaded.memory)
  })
})

describe('useAgentIdentityFiles baseline after an agent switch mid-save', () => {
  it('keeps the newer agent baseline when an older save finishes late', async () => {
    const filesB: AgentReadableFiles = { ...DEFAULT_AGENT_FILES, memory: '- B fact.\n' }
    readFiles.mockImplementation(async (id: string) => (id === 'b1' ? filesB : loaded))
    let finishWrite: () => void = () => {}
    writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        })
    )
    await act(async () => root.render(<Probe agentId="a1" />))
    await act(async () => current().setAgentFiles({ ...current().agentFiles, soul: 'A soul.\n' }))
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = current().saveAgentFiles('a1')
    })
    await act(async () => root.render(<Probe agentId="b1" />))
    await act(async () => {
      finishWrite()
      await pending
    })

    writeFile.mockClear()
    await act(async () => current().setAgentFiles({ ...current().agentFiles, soul: 'B soul.\n' }))
    await act(async () => current().saveAgentFiles('b1'))
    expect(writeFile).toHaveBeenCalledWith('b1', 'soul', 'B soul.\n', filesB.soul)
  })
})
