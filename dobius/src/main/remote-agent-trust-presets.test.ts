import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getActiveMultiplexer: vi.fn(),
  getSshFilesystemProvider: vi.fn()
}))

vi.mock('./ipc/ssh', () => ({
  getActiveMultiplexer: mocks.getActiveMultiplexer
}))

vi.mock('./providers/ssh-filesystem-dispatch', () => ({
  getSshFilesystemProvider: mocks.getSshFilesystemProvider
}))

const { markRemoteAgentWorkspaceTrusted } = await import('./remote-agent-trust-presets')

function makeFsProvider(overrides: Record<string, unknown> = {}) {
  return {
    realpath: vi.fn(async (path: string) => `/real${path}`),
    readFile: vi.fn(async () => ({ content: '', isBinary: false })),
    createDir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    stat: vi.fn(async () => {
      throw new Error('missing')
    }),
    ...overrides
  }
}

describe('markRemoteAgentWorkspaceTrusted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getActiveMultiplexer.mockReturnValue({
      request: vi.fn(async () => ({ resolvedPath: '/home/u/' }))
    })
  })

  it('writes Codex trust to the remote home and canonicalized workspace path', async () => {
    const fsProvider = makeFsProvider()
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'codex',
      connectionId: 'ssh-1',
      workspacePath: '/repo/worktree'
    })

    expect(mocks.getActiveMultiplexer).toHaveBeenCalledWith('ssh-1')
    expect(fsProvider.realpath).toHaveBeenCalledWith('/repo/worktree')
    expect(fsProvider.createDir).toHaveBeenCalledWith('/home/u/.codex')
    expect(fsProvider.writeFile).toHaveBeenCalledWith(
      '/home/u/.codex/config.toml',
      expect.stringContaining('[projects."/real/repo/worktree"]')
    )
  })

  it('writes Codex trust when the remote home is a Windows absolute path', async () => {
    const fsProvider = makeFsProvider({
      realpath: vi.fn(async () => 'C:/Users/alice/platform')
    })
    mocks.getActiveMultiplexer.mockReturnValue({
      request: vi.fn(async () => ({ resolvedPath: 'C:\\Users\\alice\\' }))
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'codex',
      connectionId: 'ssh-windows',
      workspacePath: 'C:\\Users\\alice\\platform'
    })

    expect(fsProvider.createDir).toHaveBeenCalledWith('C:/Users/alice/.codex')
    expect(fsProvider.writeFile).toHaveBeenCalledWith(
      'C:/Users/alice/.codex/config.toml',
      expect.stringContaining('[projects."C:/Users/alice/platform"]')
    )
  })

  it('writes Cursor trust marker on the remote host', async () => {
    const fsProvider = makeFsProvider()
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'cursor',
      connectionId: 'ssh-1',
      workspacePath: '/repo/worktree'
    })

    expect(fsProvider.createDir).toHaveBeenCalledWith('/home/u/.cursor/projects/real-repo-worktree')
    expect(fsProvider.writeFile).toHaveBeenCalledWith(
      '/home/u/.cursor/projects/real-repo-worktree/.workspace-trusted',
      expect.stringContaining('"workspacePath": "/real/repo/worktree"')
    )
  })

  it('sanitizes Windows path characters in remote Cursor trust marker paths', async () => {
    const fsProvider = makeFsProvider({
      realpath: vi.fn(async () => 'C:/Users/alice/platform')
    })
    mocks.getActiveMultiplexer.mockReturnValue({
      request: vi.fn(async () => ({ resolvedPath: 'C:/Users/alice/' }))
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'cursor',
      connectionId: 'ssh-windows',
      workspacePath: 'C:\\Users\\alice\\platform'
    })

    expect(fsProvider.createDir).toHaveBeenCalledWith(
      'C:/Users/alice/.cursor/projects/C-Users-alice-platform'
    )
    expect(fsProvider.writeFile).toHaveBeenCalledWith(
      'C:/Users/alice/.cursor/projects/C-Users-alice-platform/.workspace-trusted',
      expect.stringContaining('"workspacePath": "C:/Users/alice/platform"')
    )
  })

  it('appends Copilot trusted folder remotely without clobbering config keys', async () => {
    const writeFile = vi.fn(async (_filePath: string, _content: string) => undefined)
    const fsProvider = makeFsProvider({
      readFile: vi.fn(async () => ({
        content: JSON.stringify({ firstLaunchAt: '2026-01-01', trustedFolders: ['/old'] }),
        isBinary: false
      })),
      writeFile
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'copilot',
      connectionId: 'ssh-1',
      workspacePath: '/repo/worktree'
    })

    expect(fsProvider.createDir).toHaveBeenCalledWith('/home/u/.copilot')
    const written = writeFile.mock.calls[0]?.[1]
    expect(typeof written).toBe('string')
    expect(JSON.parse(written as string)).toEqual({
      firstLaunchAt: '2026-01-01',
      trustedFolders: ['/old', '/real/repo/worktree']
    })
  })

  describe('remote config read failures (BUILD-009C)', () => {
    function errnoError(code: string): Error {
      return Object.assign(new Error(`${code}: remote read failed`), { code })
    }

    it.each([
      ['codex', 'EACCES'],
      ['codex', 'EIO'],
      ['codex', 'CONNECTION_LOST'],
      ['copilot', 'EACCES'],
      ['copilot', 'EIO'],
      ['copilot', 'CONNECTION_LOST']
    ] as const)(
      '%s: a %s read error writes nothing and surfaces the error',
      async (preset, code) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const fsProvider = makeFsProvider({
          readFile: vi.fn(async () => {
            throw errnoError(code)
          })
        })
        mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

        await expect(
          markRemoteAgentWorkspaceTrusted({
            preset,
            connectionId: 'ssh-1',
            workspacePath: '/repo/worktree'
          })
        ).rejects.toThrow(code)

        expect(fsProvider.createDir).not.toHaveBeenCalled()
        expect(fsProvider.writeFile).not.toHaveBeenCalled()
        warn.mockRestore()
      }
    )

    it.each(['codex', 'copilot'] as const)(
      '%s: a binary remote config is left unchanged',
      async (preset) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const fsProvider = makeFsProvider({
          readFile: vi.fn(async () => ({ content: 'AAAA', isBinary: true }))
        })
        mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

        await expect(
          markRemoteAgentWorkspaceTrusted({
            preset,
            connectionId: 'ssh-1',
            workspacePath: '/repo/worktree'
          })
        ).rejects.toThrow(/not a text file/)

        expect(fsProvider.writeFile).not.toHaveBeenCalled()
        warn.mockRestore()
      }
    )

    it.each([
      ['codex', '/home/u/.codex/config.toml'],
      ['copilot', '/home/u/.copilot/config.json']
    ] as const)('%s: a missing remote config (ENOENT) is created', async (preset, configPath) => {
      const fsProvider = makeFsProvider({
        readFile: vi.fn(async () => {
          throw errnoError('ENOENT')
        })
      })
      mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

      await markRemoteAgentWorkspaceTrusted({
        preset,
        connectionId: 'ssh-1',
        workspacePath: '/repo/worktree'
      })

      expect(fsProvider.writeFile).toHaveBeenCalledWith(
        configPath,
        expect.stringContaining('/real/repo/worktree')
      )
    })

    it('copilot: a config that is valid JSON but not an object is left unchanged', async () => {
      const fsProvider = makeFsProvider({
        readFile: vi.fn(async () => ({ content: '["/old"]', isBinary: false }))
      })
      mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

      await markRemoteAgentWorkspaceTrusted({
        preset: 'copilot',
        connectionId: 'ssh-1',
        workspacePath: '/repo/worktree'
      })

      expect(fsProvider.writeFile).not.toHaveBeenCalled()
    })
  })

  it('does nothing when the SSH home cannot be resolved safely', async () => {
    const fsProvider = makeFsProvider()
    mocks.getActiveMultiplexer.mockReturnValue({
      request: vi.fn(async () => ({ resolvedPath: 'relative/home' }))
    })
    mocks.getSshFilesystemProvider.mockReturnValue(fsProvider)

    await markRemoteAgentWorkspaceTrusted({
      preset: 'codex',
      connectionId: 'ssh-1',
      workspacePath: '/repo/worktree'
    })

    expect(fsProvider.writeFile).not.toHaveBeenCalled()
  })
})
