import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testState = { dir: '', savedPath: null as string | null, canceled: false }

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  },
  dialog: {
    showSaveDialog: vi.fn(async () => ({
      canceled: testState.canceled,
      filePath: testState.canceled ? undefined : testState.savedPath
    }))
  }
}))

describe('team-snapshot', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-team-snapshot-'))
    testState.savedPath = join(testState.dir, 'exported.team.json')
    testState.canceled = false
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('exports, previews, and imports a team snapshot, creating brand-new member agents', async () => {
    const { createAgent } = await import('../../agents/agents-store')
    const { createTeam } = await import('../team-store')
    const {
      exportTeamSnapshot,
      encodeTeamSnapshotForSend,
      previewTeamSnapshotImport,
      confirmTeamSnapshotImport
    } = await import('./team-snapshot')

    const member1 = createAgent({ name: 'Alpha', systemPrompt: 'a', engine: 'claude', model: 'm' }).at(-1)!
    const member2 = createAgent({ name: 'Beta', systemPrompt: 'b', engine: 'codex', model: '' }).at(-1)!
    const team = createTeam({
      name: 'Support Squad',
      description: 'desc',
      instructions: 'be kind',
      personaIds: [member1.id, member2.id]
    }).at(-1)!

    const encoded = encodeTeamSnapshotForSend({ id: team.id, memoryLevel: 'none', format: 'json' })
    expect(encoded.fileName).toMatch(/\.team\.json$/)
    const envelope = JSON.parse(Buffer.from(encoded.fileBytes).toString('utf-8'))
    expect(envelope).toMatchObject({ magic: 'buzz-team-snapshot', version: 1, name: 'Support Squad' })
    expect(envelope.members).toHaveLength(2)
    expect(envelope.members.map((m: { displayName: string }) => m.displayName).sort()).toEqual(['Alpha', 'Beta'])

    const preview = previewTeamSnapshotImport(encoded.fileBytes)
    expect(preview.name).toBe('Support Squad')
    expect(preview.members).toHaveLength(2)

    const result = confirmTeamSnapshotImport({ fileBytes: encoded.fileBytes, keepAllowlist: false })
    expect(result.team.name).toBe('Support Squad')
    expect(result.personaIds).toHaveLength(2)
    expect(result.members).toHaveLength(2)
    for (const member of result.members) {
      expect(member.personaId).toBeTruthy()
      expect(member.pubkey).toMatch(/^[0-9a-f]{64}$/)
      expect(member.memoryErrors).toEqual([])
    }
    // Brand-new agents, not the originals.
    expect(result.personaIds).not.toContain(member1.id)
    expect(result.personaIds).not.toContain(member2.id)

    const saved = await exportTeamSnapshot({ id: team.id, memoryLevel: 'none', format: 'json' })
    expect(saved).toBe(true)
    const onDisk = JSON.parse(readFileSync(testState.savedPath!, 'utf-8'))
    expect(onDisk.name).toBe('Support Squad')
  })

  it('exportTeamSnapshot returns false when the user cancels', async () => {
    const { createTeam } = await import('../team-store')
    const { exportTeamSnapshot } = await import('./team-snapshot')
    const team = createTeam({ name: 'X', personaIds: [] }).at(-1)!
    testState.canceled = true
    const saved = await exportTeamSnapshot({ id: team.id, memoryLevel: 'none', format: 'json' })
    expect(saved).toBe(false)
  })

  it('throws for export/encode of a missing team', async () => {
    const { exportTeamSnapshot, encodeTeamSnapshotForSend } = await import('./team-snapshot')
    await expect(exportTeamSnapshot({ id: 'ghost', memoryLevel: 'none', format: 'json' })).rejects.toThrow(
      /Team not found/
    )
    expect(() => encodeTeamSnapshotForSend({ id: 'ghost', memoryLevel: 'none', format: 'json' })).toThrow(
      /Team not found/
    )
  })

  it('rejects a malformed team snapshot cleanly', async () => {
    const { previewTeamSnapshotImport, confirmTeamSnapshotImport } = await import('./team-snapshot')
    expect(() => previewTeamSnapshotImport([])).toThrow(/Snapshot file is empty/)
    expect(() =>
      previewTeamSnapshotImport(Array.from(Buffer.from(JSON.stringify({ magic: 'buzz-agent-snapshot', version: 1 }))))
    ).toThrow(/Unrecognized snapshot type/)
    expect(() =>
      confirmTeamSnapshotImport({
        fileBytes: Array.from(Buffer.from(JSON.stringify({ magic: 'buzz-team-snapshot', version: 1 }))),
        keepAllowlist: false
      })
    ).toThrow(/missing a name/)
  })

  it('caps the number of members a single snapshot can create agents for', async () => {
    const { confirmTeamSnapshotImport } = await import('./team-snapshot')
    const members = Array.from({ length: 250 }, (_, i) => ({
      displayName: `Member ${i}`,
      systemPrompt: '',
      model: 'm',
      runtime: 'claude',
      accountId: null,
      avatarUrl: null,
      respondToAllowlist: [],
      memoryLevel: 'none'
    }))
    const envelope = { magic: 'buzz-team-snapshot', version: 1, name: 'Huge Team', description: null, instructions: null, members }
    const result = confirmTeamSnapshotImport({
      fileBytes: Array.from(Buffer.from(JSON.stringify(envelope))),
      keepAllowlist: false
    })
    expect(result.members.length).toBeLessThanOrEqual(200)
  })

  it('never embeds a token/key-shaped value anywhere in an exported team snapshot', async () => {
    const { createAgent } = await import('../../agents/agents-store')
    const { createTeam } = await import('../team-store')
    const { encodeTeamSnapshotForSend } = await import('./team-snapshot')
    const secretLooking = 'sk-thisIsNotAllowedToLeaveTheDevice1234567890'
    const member = createAgent({
      name: 'Bound',
      systemPrompt: '',
      engine: 'claude',
      model: 'm',
      accountId: secretLooking
    }).at(-1)!
    const team = createTeam({ name: 'Secretive Team', personaIds: [member.id], accountIds: [] }).at(-1)!
    const encoded = encodeTeamSnapshotForSend({ id: team.id, memoryLevel: 'none', format: 'json' })
    const text = Buffer.from(encoded.fileBytes).toString('utf-8')
    expect(text).not.toContain(secretLooking)
  })

  it('does not create a duplicate agent when one member fails to import (partial-success contract)', async () => {
    const { confirmTeamSnapshotImport } = await import('./team-snapshot')
    const members = [
      {
        displayName: 'Good Member',
        systemPrompt: '',
        model: 'm',
        runtime: 'claude',
        accountId: null,
        avatarUrl: null,
        respondToAllowlist: [],
        memoryLevel: 'none'
      },
      // Blank display name — createAgentFromEnvelope's underlying createAgent
      // call rejects an empty/whitespace name, so this member should fail
      // without taking the whole import down.
      {
        displayName: '   ',
        systemPrompt: '',
        model: 'm',
        runtime: 'claude',
        accountId: null,
        avatarUrl: null,
        respondToAllowlist: [],
        memoryLevel: 'none'
      }
    ]
    const envelope = { magic: 'buzz-team-snapshot', version: 1, name: 'Partial Team', description: null, instructions: null, members }
    const result = confirmTeamSnapshotImport({
      fileBytes: Array.from(Buffer.from(JSON.stringify(envelope))),
      keepAllowlist: false
    })
    expect(result.members).toHaveLength(2)
    expect(result.members[0].memoryErrors).toEqual([])
    expect(result.members[1].memoryErrors.length).toBeGreaterThan(0)
    expect(result.personaIds).toHaveLength(1)
    expect(result.team.personaIds).toHaveLength(1)
  })
})
