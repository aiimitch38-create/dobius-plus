import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import { FILE_METHODS } from './files'

vi.mock('../../../storage/user-data-root', () => ({
  getUserDataRoot: () => '/nonexistent-dobius-user-data'
}))

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

async function dispatchAs(
  clientKind: 'mobile' | 'runtime',
  method: string,
  params: Record<string, unknown>
): Promise<{ ok: boolean; runtime: Record<string, ReturnType<typeof vi.fn>> }> {
  const runtime = {
    getRuntimeId: vi.fn().mockReturnValue('test-runtime'),
    resolveMobileWriteRoot: vi.fn().mockResolvedValue({ root: '/nonexistent-repo/wt' }),
    createFileExplorerFile: vi.fn().mockResolvedValue({ ok: true }),
    writeTerminalArtifactFile: vi.fn().mockResolvedValue({ ok: true })
  }
  const dispatcher = new RpcDispatcher({
    runtime: runtime as unknown as DobiusRuntimeService,
    methods: FILE_METHODS
  })
  const replies: { ok: boolean }[] = []
  await dispatcher.dispatchStreaming(
    makeRequest(method, params),
    (reply) => replies.push(JSON.parse(reply) as { ok: boolean }),
    { clientKind }
  )
  return { ok: replies[0]!.ok, runtime }
}

describe('mobile file writes run the host-side path guard (BUILD-034)', () => {
  it("refuses a terminal-artifact write into Dobius's own data", async () => {
    const { ok, runtime } = await dispatchAs('mobile', 'files.writeTerminalArtifact', {
      worktree: 'id:wt',
      grantId: 'g',
      absolutePath: '/nonexistent-dobius-user-data/dobius-devices.json',
      content: '[]'
    })
    expect(ok).toBe(false)
    expect(runtime.writeTerminalArtifactFile).not.toHaveBeenCalled()
  })

  it('refuses a terminal-artifact write to ~/.claude-style instruction paths outside the worktree', async () => {
    const { ok, runtime } = await dispatchAs('mobile', 'files.writeTerminalArtifact', {
      worktree: 'id:wt',
      grantId: 'g',
      absolutePath: '/nonexistent-home/.claude/settings.json',
      content: '{}'
    })
    expect(ok).toBe(false)
    expect(runtime.writeTerminalArtifactFile).not.toHaveBeenCalled()
  })

  it('refuses createFile of a folded protected name', async () => {
    const { ok, runtime } = await dispatchAs('mobile', 'files.createFile', {
      worktree: 'id:wt',
      relativePath: 'docs/../AGENT\u017F.md'
    })
    expect(ok).toBe(false)
    expect(runtime.createFileExplorerFile).not.toHaveBeenCalled()
  })

  it('lets ordinary mobile writes and all runtime-client writes through', async () => {
    await expect(
      dispatchAs('mobile', 'files.createFile', { worktree: 'id:wt', relativePath: 'docs/a.md' })
    ).resolves.toMatchObject({ ok: true })
    await expect(
      dispatchAs('runtime', 'files.writeTerminalArtifact', {
        worktree: 'id:wt',
        grantId: 'g',
        absolutePath: '/nonexistent-dobius-user-data/dobius-devices.json',
        content: '[]'
      })
    ).resolves.toMatchObject({ ok: true })
  })
})
