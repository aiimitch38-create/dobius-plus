import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'

// Why: team-store persists to the userData directory via node:fs + electron,
// so it's mocked here the same way custom-agents.test.ts mocks agents-store.
vi.mock('../../../communications/team-store', () => ({
  listTeams: vi.fn(),
  getTeam: vi.fn(),
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  removeTeam: vi.fn()
}))

import {
  createTeam,
  getTeam,
  listTeams,
  removeTeam,
  updateTeam
} from '../../../communications/team-store'
import { TEAM_METHODS } from './teams'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function makeDispatcher(): RpcDispatcher {
  return new RpcDispatcher({ runtime, methods: TEAM_METHODS })
}

describe('team RPC methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists, shows, and deletes teams through the store', async () => {
    const team = { id: 'team-1', name: 'Support Squad', personaIds: ['agent-1'] }
    vi.mocked(listTeams).mockReturnValue([team] as never)
    vi.mocked(getTeam).mockReturnValue(team as never)
    const dispatcher = makeDispatcher()

    await expect(dispatcher.dispatch(makeRequest('team.list'))).resolves.toMatchObject({
      ok: true,
      result: { teams: [team] }
    })
    await expect(
      dispatcher.dispatch(makeRequest('team.show', { id: 'team-1' }))
    ).resolves.toMatchObject({ ok: true, result: { team } })
    await expect(
      dispatcher.dispatch(makeRequest('team.delete', { id: 'team-1' }))
    ).resolves.toMatchObject({ ok: true, result: { removed: true, id: 'team-1' } })
    expect(removeTeam).toHaveBeenCalledWith('team-1')
  })

  it('rejects show and delete for a missing team', async () => {
    vi.mocked(getTeam).mockReturnValue(null)
    await expect(
      makeDispatcher().dispatch(makeRequest('team.show', { id: 'ghost' }))
    ).resolves.toMatchObject({ ok: false })
    await expect(
      makeDispatcher().dispatch(makeRequest('team.delete', { id: 'ghost' }))
    ).resolves.toMatchObject({ ok: false })
    expect(removeTeam).not.toHaveBeenCalled()
  })

  it('returns the newly appended team from create and the edited team from update', async () => {
    const older = { id: 'team-1', name: 'Old' }
    const created = { id: 'team-2', name: 'Support Squad', personaIds: ['agent-1', 'agent-2'] }
    vi.mocked(createTeam).mockReturnValue([older, created] as never)
    vi.mocked(updateTeam).mockReturnValue([older, created] as never)
    const dispatcher = makeDispatcher()

    await expect(
      dispatcher.dispatch(
        makeRequest('team.create', { name: 'Support Squad', personaIds: ['agent-1', 'agent-2'] })
      )
    ).resolves.toMatchObject({ ok: true, result: { team: created } })
    expect(createTeam).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Support Squad', personaIds: ['agent-1', 'agent-2'] })
    )

    await expect(
      dispatcher.dispatch(
        makeRequest('team.update', { id: 'team-1', updates: { personaIds: ['agent-3'] } })
      )
    ).resolves.toMatchObject({ ok: true, result: { team: older } })
    expect(updateTeam).toHaveBeenCalledWith('team-1', expect.objectContaining({ personaIds: ['agent-3'] }))
  })

  it('rejects create without a name', async () => {
    await expect(
      makeDispatcher().dispatch(makeRequest('team.create', { personaIds: ['agent-1'] }))
    ).resolves.toMatchObject({ ok: false })
    expect(createTeam).not.toHaveBeenCalled()
  })

  it('passes accountIds through to the store on create and update', async () => {
    const created = { id: 'team-1', name: 'Support Squad', accountIds: ['acct-1'] }
    vi.mocked(createTeam).mockReturnValue([created] as never)
    vi.mocked(updateTeam).mockReturnValue([created] as never)
    const dispatcher = makeDispatcher()

    await dispatcher.dispatch(
      makeRequest('team.create', { name: 'Support Squad', accountIds: ['acct-1'] })
    )
    expect(createTeam).toHaveBeenCalledWith(expect.objectContaining({ accountIds: ['acct-1'] }))

    await dispatcher.dispatch(
      makeRequest('team.update', { id: 'team-1', updates: { accountIds: ['acct-2'] } })
    )
    expect(updateTeam).toHaveBeenCalledWith('team-1', expect.objectContaining({ accountIds: ['acct-2'] }))
  })
})
