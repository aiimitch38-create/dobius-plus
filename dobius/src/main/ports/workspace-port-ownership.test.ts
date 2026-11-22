import { afterEach, describe, expect, it, vi } from 'vitest'

const { scanMock } = vi.hoisted(() => ({ scanMock: vi.fn() }))
vi.mock('./local-workspace-port-scanner', () => ({ scanWorkspacePorts: scanMock }))

import { killWorkspacePort } from './workspace-port-ownership'

const probe = { id: 'repo::/w/a', repoId: 'repo', displayName: 'a', path: '/w/a' }
const owner = (worktreeId: string) => ({
  worktreeId,
  repoId: 'repo',
  displayName: worktreeId,
  path: '/w',
  confidence: 'cwd' as const
})
const base = { bindHost: '127.0.0.1', connectHost: 'localhost', protocol: 'http' as const }

function scanWith(ports: unknown[]): void {
  scanMock.mockResolvedValue({ platform: 'darwin', scannedAt: 1, ports })
}

afterEach(() => {
  scanMock.mockReset()
  vi.restoreAllMocks()
})

describe('killWorkspacePort', () => {
  it('kills a listener owned by the named worktree (re-scanned, never trusting the caller pid)', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    scanWith([{ ...base, id: 'p', port: 5173, pid: 4242, kind: 'workspace', owner: owner('repo::/w/a') }])
    await expect(
      killWorkspacePort([probe], { worktreeId: 'repo::/w/a', pid: 4242, port: 5173 })
    ).resolves.toEqual({ ok: true })
    expect(kill).toHaveBeenCalledWith(4242, 'SIGTERM')
  })

  it("refuses a listener that belongs to a different worktree", async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    scanWith([{ ...base, id: 'p', port: 5173, pid: 4242, kind: 'workspace', owner: owner('repo::/w/b') }])
    await expect(
      killWorkspacePort([probe], { worktreeId: 'repo::/w/a', pid: 4242, port: 5173 })
    ).resolves.toEqual({ ok: false, reason: 'The port belongs to a different worktree.' })
    expect(kill).not.toHaveBeenCalled()
  })

  it('refuses system/other-app (external) and container listeners', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    for (const kind of ['external', 'container']) {
      scanWith([{ ...base, id: 'p', port: 5000, pid: 99, kind }])
      await expect(
        killWorkspacePort([probe], { worktreeId: 'repo::/w/a', pid: 99, port: 5000 })
      ).resolves.toMatchObject({ ok: false })
    }
    expect(kill).not.toHaveBeenCalled()
  })

  it('refuses a pid/port pair that is no longer listening', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    scanWith([])
    await expect(
      killWorkspacePort([probe], { worktreeId: 'repo::/w/a', pid: 1, port: 3000 })
    ).resolves.toEqual({ ok: false, reason: 'The port is no longer listening.' })
    expect(kill).not.toHaveBeenCalled()
  })
})
