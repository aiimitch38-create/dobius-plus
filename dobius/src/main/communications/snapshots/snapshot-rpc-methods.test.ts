import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RpcDispatcher } from '../../runtime/rpc/dispatcher'
import type { RpcRequest } from '../../runtime/rpc/core'
import type { DobiusRuntimeService } from '../../runtime/dobius-runtime'

vi.mock('./agent-snapshot', () => ({
  exportAgentSnapshot: vi.fn(),
  encodeAgentSnapshotForSend: vi.fn(),
  previewAgentSnapshotImport: vi.fn(),
  confirmAgentSnapshotImport: vi.fn()
}))
vi.mock('./team-snapshot', () => ({
  exportTeamSnapshot: vi.fn(),
  encodeTeamSnapshotForSend: vi.fn(),
  previewTeamSnapshotImport: vi.fn(),
  confirmTeamSnapshotImport: vi.fn()
}))
vi.mock('./snapshot-fetch', () => ({
  fetchSnapshotBytes: vi.fn()
}))

import {
  confirmAgentSnapshotImport,
  encodeAgentSnapshotForSend,
  exportAgentSnapshot,
  previewAgentSnapshotImport
} from './agent-snapshot'
import {
  confirmTeamSnapshotImport,
  encodeTeamSnapshotForSend,
  exportTeamSnapshot,
  previewTeamSnapshotImport
} from './team-snapshot'
import { fetchSnapshotBytes } from './snapshot-fetch'
import { SNAPSHOT_METHODS } from './snapshot-rpc-methods'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function makeDispatcher(): RpcDispatcher {
  return new RpcDispatcher({ runtime, methods: SNAPSHOT_METHODS })
}

describe('snapshot RPC methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('agent.snapshot.export wraps the boolean result as { saved }', async () => {
    vi.mocked(exportAgentSnapshot).mockResolvedValue(true)
    await expect(
      makeDispatcher().dispatch(
        makeRequest('agent.snapshot.export', { id: 'agent-1', memoryLevel: 'none', format: 'json' })
      )
    ).resolves.toMatchObject({ ok: true, result: { saved: true } })
    // Why no avatarPngDataUrl key here: zod's `.optional()` special-cases a
    // MISSING object key to stay absent rather than running the transform
    // (see schemas.ts's OptionalFiniteNumber doc) — an omitted
    // avatarPngDataUrl never becomes an explicit `null` key on params.
    expect(exportAgentSnapshot).toHaveBeenCalledWith({ id: 'agent-1', memoryLevel: 'none', format: 'json' })
  })

  it('agent.snapshot.encode / previewImport / confirmImport pass through', async () => {
    vi.mocked(encodeAgentSnapshotForSend).mockReturnValue({ fileBytes: [1, 2], fileName: 'x.json' } as never)
    await expect(
      makeDispatcher().dispatch(
        makeRequest('agent.snapshot.encode', { id: 'agent-1', memoryLevel: 'core', format: 'json' })
      )
    ).resolves.toMatchObject({ ok: true, result: { fileBytes: [1, 2], fileName: 'x.json' } })

    vi.mocked(previewAgentSnapshotImport).mockReturnValue({ displayName: 'X' } as never)
    await expect(
      makeDispatcher().dispatch(makeRequest('agent.snapshot.previewImport', { fileBytes: [1, 2] }))
    ).resolves.toMatchObject({ ok: true, result: { displayName: 'X' } })

    vi.mocked(confirmAgentSnapshotImport).mockReturnValue({ displayName: 'X', personaId: 'p1' } as never)
    await expect(
      makeDispatcher().dispatch(
        makeRequest('agent.snapshot.confirmImport', { fileBytes: [1, 2], keepAllowlist: true })
      )
    ).resolves.toMatchObject({ ok: true, result: { personaId: 'p1' } })
    expect(confirmAgentSnapshotImport).toHaveBeenCalledWith({ fileBytes: [1, 2], keepAllowlist: true })
  })

  it('rejects previewImport/confirmImport with an oversized fileBytes array', async () => {
    const tooMany = Array.from({ length: 4 * 1024 * 1024 + 1 }, () => 0)
    await expect(
      makeDispatcher().dispatch(makeRequest('agent.snapshot.previewImport', { fileBytes: tooMany }))
    ).resolves.toMatchObject({ ok: false })
    expect(previewAgentSnapshotImport).not.toHaveBeenCalled()
  })

  it('rejects fileBytes entries outside the byte range', async () => {
    await expect(
      makeDispatcher().dispatch(makeRequest('agent.snapshot.previewImport', { fileBytes: [1, 999, 3] }))
    ).resolves.toMatchObject({ ok: false })
  })

  it('team.snapshot.export / encode / previewImport / confirmImport pass through', async () => {
    vi.mocked(exportTeamSnapshot).mockResolvedValue(false)
    await expect(
      makeDispatcher().dispatch(
        makeRequest('team.snapshot.export', { id: 'team-1', memoryLevel: 'none', format: 'png' })
      )
    ).resolves.toMatchObject({ ok: true, result: { saved: false } })

    vi.mocked(encodeTeamSnapshotForSend).mockReturnValue({ fileBytes: [9], fileName: 'y.team.json' } as never)
    await expect(
      makeDispatcher().dispatch(
        makeRequest('team.snapshot.encode', { id: 'team-1', memoryLevel: 'none', format: 'json' })
      )
    ).resolves.toMatchObject({ ok: true, result: { fileName: 'y.team.json' } })

    vi.mocked(previewTeamSnapshotImport).mockReturnValue({ name: 'Team' } as never)
    await expect(
      makeDispatcher().dispatch(makeRequest('team.snapshot.previewImport', { fileBytes: [1] }))
    ).resolves.toMatchObject({ ok: true, result: { name: 'Team' } })

    vi.mocked(confirmTeamSnapshotImport).mockReturnValue({ personaIds: ['p1'] } as never)
    await expect(
      makeDispatcher().dispatch(
        makeRequest('team.snapshot.confirmImport', { fileBytes: [1], keepAllowlist: false })
      )
    ).resolves.toMatchObject({ ok: true, result: { personaIds: ['p1'] } })
  })

  it('snapshot.fetchBytes validates and forwards params', async () => {
    vi.mocked(fetchSnapshotBytes).mockResolvedValue({ bytesBase64: 'aGVsbG8=' })
    await expect(
      makeDispatcher().dispatch(
        makeRequest('snapshot.fetchBytes', {
          url: 'http://localhost:3300/media/x.png',
          filename: 'x.png',
          expectedSha256: 'a'.repeat(64),
          expectedSize: 5
        })
      )
    ).resolves.toMatchObject({ ok: true, result: { bytesBase64: 'aGVsbG8=' } })
  })

  it('rejects snapshot.fetchBytes with a missing url', async () => {
    await expect(
      makeDispatcher().dispatch(
        makeRequest('snapshot.fetchBytes', { filename: 'x', expectedSha256: 'a'.repeat(64), expectedSize: 1 })
      )
    ).resolves.toMatchObject({ ok: false })
    expect(fetchSnapshotBytes).not.toHaveBeenCalled()
  })
})
