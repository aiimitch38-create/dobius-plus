import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Why: team-store keys its file location off Electron's userData path, so the
// electron module is mocked to point at a per-test temp directory — same
// pattern as persistence.test.ts.
const testState = { dir: '' }

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  }
}))

describe('team-store', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-team-store-'))
    // Why: team-store caches its roster in a module-level variable, so each
    // test needs a fresh module instance to avoid leaking state across tests
    // that use different temp directories.
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('creates, lists, updates, and deletes a team', async () => {
    const { createTeam, listTeams, updateTeam, removeTeam } = await import('./team-store')

    expect(listTeams()).toEqual([])

    const afterCreate = createTeam({
      name: 'Support Squad',
      description: 'Handles tickets',
      instructions: 'Be kind',
      personaIds: ['agent-1', 'agent-2']
    })
    expect(afterCreate).toHaveLength(1)
    const created = afterCreate[0]
    expect(created).toMatchObject({
      name: 'Support Squad',
      description: 'Handles tickets',
      instructions: 'Be kind',
      personaIds: ['agent-1', 'agent-2']
    })
    expect(created.id).toBeTruthy()
    expect(created.createdAt).toBeTypeOf('number')
    expect(created.updatedAt).toBeTypeOf('number')

    expect(listTeams()).toEqual(afterCreate)

    const afterUpdate = updateTeam(created.id, { name: 'Renamed Squad', personaIds: ['agent-3'] })
    const updated = afterUpdate.find((team) => team.id === created.id)
    expect(updated).toMatchObject({ name: 'Renamed Squad', personaIds: ['agent-3'] })
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)

    const afterDelete = removeTeam(created.id)
    expect(afterDelete).toEqual([])
    expect(listTeams()).toEqual([])
  })

  it('rejects updating a team that does not exist', async () => {
    const { updateTeam } = await import('./team-store')
    expect(() => updateTeam('ghost', { name: 'X' })).toThrow('Team not found')
  })

  it('rejects a blank team name on create and update', async () => {
    const { createTeam, updateTeam } = await import('./team-store')
    expect(() => createTeam({ name: '   ' })).toThrow('Team name is required')

    const [team] = createTeam({ name: 'Valid Team' })
    expect(() => updateTeam(team.id, { name: '  ' })).toThrow('Team name is required')
  })

  it('deduplicates persona ids and drops blanks', async () => {
    const { createTeam } = await import('./team-store')
    const [team] = createTeam({
      name: 'Dedup Team',
      personaIds: ['agent-1', 'agent-1', '', '  ', 'agent-2']
    })
    expect(team.personaIds).toEqual(['agent-1', 'agent-2'])
  })

  it('persists teams to disk across a fresh module load', async () => {
    const first = await import('./team-store')
    const [team] = first.createTeam({ name: 'Durable Team', personaIds: ['agent-9'] })

    vi.resetModules()
    const second = await import('./team-store')
    const reloaded = second.listTeams()
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]).toMatchObject({
      id: team.id,
      name: 'Durable Team',
      personaIds: ['agent-9']
    })
  })

  it('round-trips referenced agent ids intact without validating them', async () => {
    const { createTeam } = await import('./team-store')
    const personaIds = ['agent-a', 'agent-b', 'agent-does-not-exist']
    const [team] = createTeam({ name: 'Roster Team', personaIds })
    expect(team.personaIds).toEqual(personaIds)
  })

  it('creates and updates a team with bound account ids', async () => {
    const { createTeam, updateTeam } = await import('./team-store')
    const accountIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
    const [team] = createTeam({ name: 'Account Bound Team', accountIds })
    expect(team.accountIds).toEqual(accountIds)

    const [updated] = updateTeam(team.id, {
      accountIds: ['33333333-3333-4333-8333-333333333333']
    })
    expect(updated.accountIds).toEqual(['33333333-3333-4333-8333-333333333333'])
  })

  it('deduplicates account ids and drops blanks, same as persona ids', async () => {
    const { createTeam } = await import('./team-store')
    const [team] = createTeam({
      name: 'Dedup Accounts Team',
      accountIds: ['acct-1', 'acct-1', '', '  ', 'acct-2']
    })
    expect(team.accountIds).toEqual(['acct-1', 'acct-2'])
  })

  it('never persists a token-shaped value in accountIds', async () => {
    const { createTeam, updateTeam } = await import('./team-store')
    const fakeJwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const fakeApiKey = `sk-${'a'.repeat(48)}`
    const fakeBearer = `Bearer ${'b'.repeat(40)}`
    const fakeLongBlob = 'x'.repeat(200)
    const realAccountId = '11111111-1111-4111-8111-111111111111'

    const [team] = createTeam({
      name: 'Guarded Team',
      accountIds: [fakeJwt, fakeApiKey, fakeBearer, fakeLongBlob, realAccountId]
    })
    expect(team.accountIds).toEqual([realAccountId])
    // Belt-and-suspenders: assert none of the fabricated secrets leaked
    // through under any circumstance, not just that the list is short.
    for (const secret of [fakeJwt, fakeApiKey, fakeBearer, fakeLongBlob]) {
      expect(team.accountIds).not.toContain(secret)
    }

    const [updated] = updateTeam(team.id, { accountIds: [fakeJwt, realAccountId] })
    expect(updated.accountIds).toEqual([realAccountId])
  })

  it('round-trips bound account ids across a fresh module load', async () => {
    const first = await import('./team-store')
    const accountIds = ['11111111-1111-4111-8111-111111111111']
    const [team] = first.createTeam({ name: 'Durable Accounts Team', accountIds })

    vi.resetModules()
    const second = await import('./team-store')
    const reloaded = second.listTeams()
    expect(reloaded[0]).toMatchObject({ id: team.id, accountIds })
  })

  it('deleting a team does not touch the agents-store module at all', async () => {
    // Why: team-store must never import or call into agents-store — deleting
    // a team is purely removing the reference record, never the agents it
    // pointed at. Asserting the module is never imported is a stronger
    // guarantee than asserting agent list contents didn't change.
    vi.doMock('../agents/agents-store', () => {
      throw new Error('team-store must not import agents-store')
    })
    const { createTeam, removeTeam } = await import('./team-store')
    const [team] = createTeam({ name: 'Isolated Team', personaIds: ['agent-1'] })
    expect(() => removeTeam(team.id)).not.toThrow()
  })
})
