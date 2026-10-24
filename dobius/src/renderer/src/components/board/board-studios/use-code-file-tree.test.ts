// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCodeFileTree } from './use-code-file-tree'

const live = vi.hoisted(() => ({
  owner: null as string | null,
  state: { sshConnectedGeneration: 0, openFile: vi.fn() },
  read: vi.fn(),
  create: vi.fn(),
  unsubscribe: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof live.state) => unknown) => selector(live.state),
    { getState: () => live.state }
  )
}))
vi.mock('@/lib/connection-context', () => ({ getConnectionId: () => 'ssh-test' }))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getSettingsForWorktreeRuntimeOwner: () => ({ activeRuntimeEnvironmentId: live.owner })
}))
vi.mock('@/runtime/runtime-file-client', () => ({
  readRuntimeDirectory: live.read,
  createRuntimePath: live.create,
  statRuntimePath: vi.fn(),
  subscribeRuntimeFileChanges: async () => live.unsubscribe
}))

beforeEach(() => {
  vi.clearAllMocks()
  live.owner = null
  live.read.mockResolvedValue([{ name: 'index.ts', isDirectory: false }])
  live.create.mockResolvedValue(undefined)
})

describe('useCodeFileTree', () => {
  it('loads and opens files with their owning workspace and SSH connection', async () => {
    const { result, unmount } = renderHook(() => useCodeFileTree('wt', '/project'))
    await waitFor(() => expect(result.current.rootCache?.children).toHaveLength(1))
    expect(live.read).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'wt', connectionId: 'ssh-test' }),
      '/project'
    )
    act(() => result.current.open(result.current.rootCache!.children[0]))
    expect(live.state.openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/project/index.ts',
        worktreeId: 'wt',
        language: 'typescript',
        mode: 'edit'
      }),
      { suppressActiveRuntimeFallback: true }
    )
    unmount()
    expect(live.unsubscribe).toHaveBeenCalledOnce()
  })

  it('creates files through the owning remote runtime before opening them', async () => {
    live.owner = 'remote-host'
    const { result } = renderHook(() => useCodeFileTree('wt', '/project'))
    await waitFor(() => expect(result.current.rootCache?.children).toHaveLength(1))
    await act(() => result.current.create('new.ts', 'file'))
    expect(live.create).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: { activeRuntimeEnvironmentId: 'remote-host' },
        worktreeId: 'wt',
        connectionId: 'ssh-test'
      }),
      '/project/new.ts',
      'file'
    )
    expect(live.state.openFile).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeEnvironmentId: 'remote-host' }),
      { suppressActiveRuntimeFallback: false }
    )
  })

  it('keeps invalid paths and failed creates out of the editor', async () => {
    const { result } = renderHook(() => useCodeFileTree('wt', '/project'))
    await waitFor(() => expect(result.current.rootCache?.children).toHaveLength(1))
    await expect(result.current.create('../outside', 'file')).rejects.toThrow()
    expect(live.create).not.toHaveBeenCalled()
    live.create.mockRejectedValueOnce(new Error('Already exists'))
    await expect(result.current.create('index.ts', 'file')).rejects.toThrow('Already exists')
    expect(live.state.openFile).not.toHaveBeenCalled()
  })
})
