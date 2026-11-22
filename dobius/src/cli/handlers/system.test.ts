import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_HANDLERS } from './system'

const callMock = vi.fn()
let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  callMock.mockReset()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
  process.exitCode = undefined
})

function ctx(flags: Record<string, string | boolean>, json = true): never {
  return {
    flags: new Map(Object.entries(flags)),
    client: { call: callMock, isRemote: false },
    cwd: '/tmp',
    json
  } as never
}

const ok = <T>(result: T) => ({ id: 'r', ok: true, result, _meta: { runtimeId: 'rt' } })
const printed = () => JSON.parse(String(logSpy.mock.calls.at(-1)?.[0])) as {
    result: { ports: { port: number }[]; configured?: boolean; ok?: boolean }
  }

const worktree = { id: 'repo::/w/a', repoId: 'repo', displayName: 'a' }
const base = { bindHost: '127.0.0.1', connectHost: 'localhost', protocol: 'http' }
const owned = (port: number, pid: number, worktreeId = 'repo::/w/a') => ({
  ...base,
  id: `${port}:${pid}`,
  port,
  pid,
  processName: 'node',
  kind: 'workspace',
  owner: { worktreeId, repoId: 'repo', displayName: worktreeId, path: '/w', confidence: 'cwd' }
})
const scan = (ports: unknown[]) => ok({ platform: 'darwin', scannedAt: 1, ports })

/** worktree.show, then workspacePorts.scan, then (maybe) workspacePorts.kill */
function routes(ports: unknown[], kill: unknown = { ok: true }) {
  callMock.mockImplementation(async (method: string) => {
    if (method === 'worktree.show') return ok({ worktree })
    if (method === 'workspacePorts.scan') return scan(ports)
    if (method === 'workspacePorts.kill') return ok(kill)
    throw new Error(`unexpected ${method}`)
  })
}

const methods = () => callMock.mock.calls.map((call) => call[0])

describe('dobius ports', () => {
  it('without --worktree scans every worktree', async () => {
    callMock.mockResolvedValueOnce(scan([owned(5173, 1)]))
    await SYSTEM_HANDLERS.ports(ctx({}))
    expect(callMock.mock.calls).toEqual([['workspacePorts.scan', {}]])
    expect(printed().result.ports).toHaveLength(1)
  })

  it('--worktree keeps only ports that worktree owns', async () => {
    routes([owned(5173, 1), owned(3000, 2, 'repo::/w/b'), { ...base, id: 'x', port: 22, pid: 3, kind: 'external' }])
    await SYSTEM_HANDLERS.ports(ctx({ worktree: 'id:repo::/w/a' }))
    expect(callMock.mock.calls[1]).toEqual(['workspacePorts.scan', {}])
    expect(printed().result.ports.map((p) => p.port)).toEqual([5173])
  })
})

describe('dobius ports kill (destructive: ownership enforced)', () => {
  it("stops the worktree's own listener and passes worktreeId so main re-checks the owner", async () => {
    routes([owned(5173, 4242)])
    await SYSTEM_HANDLERS['ports kill'](ctx({ worktree: 'id:repo::/w/a', port: '5173' }))
    expect(callMock.mock.calls.at(-1)).toEqual([
      'workspacePorts.kill',
      { worktreeId: 'repo::/w/a', pid: 4242, port: 5173 }
    ])
    expect(printed().result).toEqual({ ok: true })
    expect(process.exitCode).toBeUndefined()
  })

  it("refuses another worktree's port, another app's port and a free port", async () => {
    for (const ports of [
      [owned(5173, 4242, 'repo::/w/b')],
      [{ ...base, id: 'x', port: 5173, pid: 99, kind: 'external' }],
      [{ ...base, id: 'x', port: 5173, pid: 99, kind: 'container' }],
      []
    ]) {
      routes(ports)
      await expect(
        SYSTEM_HANDLERS['ports kill'](ctx({ worktree: 'id:repo::/w/a', port: '5173' }))
      ).rejects.toThrow(/^Refused: .*Nothing was stopped\./)
      expect(methods()).not.toContain('workspacePorts.kill')
      callMock.mockReset()
    }
  })

  it('needs --pid when several processes share the port, and refuses a pid that does not own it', async () => {
    routes([owned(5173, 1), owned(5173, 2)])
    await expect(
      SYSTEM_HANDLERS['ports kill'](ctx({ worktree: 'id:repo::/w/a', port: '5173' }))
    ).rejects.toThrow(/more than one process .*pass --pid/)
    await expect(
      SYSTEM_HANDLERS['ports kill'](ctx({ worktree: 'id:repo::/w/a', port: '5173', pid: '7' }))
    ).rejects.toThrow(/pid 7 does not own port 5173/)
    expect(methods()).not.toContain('workspacePorts.kill')
    await SYSTEM_HANDLERS['ports kill'](ctx({ worktree: 'id:repo::/w/a', port: '5173', pid: '2' }))
    expect(callMock.mock.calls.at(-1)?.[1]).toMatchObject({ pid: 2 })
  })

  it('refuses a listener attributed only by its command line (no cwd proof)', async () => {
    const guessed = owned(5173, 4242)
    guessed.owner.confidence = 'command'
    routes([guessed])
    await expect(
      SYSTEM_HANDLERS['ports kill'](ctx({ worktree: 'id:repo::/w/a', port: '5173' }))
    ).rejects.toThrow(/cannot prove the process/)
    expect(methods()).not.toContain('workspacePorts.kill')
  })

  it('exits 3 when main refuses after its own re-check', async () => {
    routes([owned(5173, 4242)], { ok: false, reason: 'The port belongs to a different worktree.' })
    await SYSTEM_HANDLERS['ports kill'](ctx({ worktree: 'id:repo::/w/a', port: '5173' }))
    expect(process.exitCode).toBe(3)
  })

  it('validates --port and requires --worktree before any call', async () => {
    for (const flags of [
      { worktree: 'id:x' },
      { worktree: 'id:x', port: 'abc' },
      { worktree: 'id:x', port: '0' },
      { port: '5173' }
    ] as Record<string, string>[]) {
      await expect(SYSTEM_HANDLERS['ports kill'](ctx(flags))).rejects.toThrow()
    }
    expect(callMock).not.toHaveBeenCalled()
  })
})

describe('dobius skills list / system / preflight', () => {
  it('skills list calls skills.discover without a cwd', async () => {
    callMock.mockResolvedValueOnce(
      ok({ skills: [{ name: 'dobius-cli', sourceLabel: 'Home', description: 'Use the CLI' }], sources: [], scannedAt: 1 })
    )
    await SYSTEM_HANDLERS['skills list'](ctx({}, false))
    expect(callMock.mock.calls).toEqual([['skills.discover', {}]])
    expect(logSpy.mock.calls.at(-1)?.[0]).toBe('dobius-cli  [Home]  Use the CLI')
  })

  it('system prints the monitor status as JSON, and says when it is not running', async () => {
    callMock.mockResolvedValueOnce(ok({ configured: true, status: { health: 'ok', volumes: [] } }))
    await SYSTEM_HANDLERS.system(ctx({}))
    expect(callMock.mock.calls).toEqual([['system.monitor.status']])
    expect(printed().result.configured).toBe(true)
    callMock.mockResolvedValueOnce(ok({ configured: false, status: null }))
    await SYSTEM_HANDLERS.system(ctx({}, false))
    expect(logSpy.mock.calls.at(-1)?.[0]).toBe('System monitor is not running.')
  })

  it('preflight passes --force and prints each tool', async () => {
    callMock.mockResolvedValueOnce(
      ok({ git: { installed: true }, gh: { installed: true, authenticated: false } })
    )
    await SYSTEM_HANDLERS.preflight(ctx({ force: true }, false))
    expect(callMock.mock.calls).toEqual([['preflight.check', { force: true }]])
    expect(logSpy.mock.calls.at(-1)?.[0]).toBe('git: installed=yes\ngh: installed=yes authenticated=no')
  })
})
