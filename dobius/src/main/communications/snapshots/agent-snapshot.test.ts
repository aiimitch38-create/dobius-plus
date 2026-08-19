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

describe('agent-snapshot', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-agent-snapshot-'))
    testState.savedPath = join(testState.dir, 'exported.agent.json')
    testState.canceled = false
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('exports, previews, and imports an agent snapshot (json format) as a brand-new agent', async () => {
    const { createAgent } = await import('../../agents/agents-store')
    const {
      exportAgentSnapshot,
      encodeAgentSnapshotForSend,
      previewAgentSnapshotImport,
      confirmAgentSnapshotImport
    } = await import('./agent-snapshot')

    const agents = createAgent({ name: 'Support Bot', systemPrompt: 'Be helpful', engine: 'claude', model: 'claude-opus-4-8' })
    const agent = agents.at(-1)!

    const encoded = encodeAgentSnapshotForSend({ id: agent.id, memoryLevel: 'core', format: 'json' })
    expect(encoded.fileName).toMatch(/\.agent\.json$/)
    const envelope = JSON.parse(Buffer.from(encoded.fileBytes).toString('utf-8'))
    expect(envelope).toMatchObject({
      magic: 'buzz-agent-snapshot',
      version: 1,
      displayName: 'Support Bot',
      systemPrompt: 'Be helpful',
      model: 'claude-opus-4-8',
      runtime: 'claude',
      memoryLevel: 'core'
    })

    const preview = previewAgentSnapshotImport(encoded.fileBytes)
    expect(preview).toMatchObject({
      displayName: 'Support Bot',
      isBuiltIn: false,
      systemPrompt: 'Be helpful',
      model: 'claude-opus-4-8',
      runtime: 'claude',
      memoryLevel: 'core',
      memoryEntryCount: 0
    })

    const result = confirmAgentSnapshotImport({ fileBytes: encoded.fileBytes, keepAllowlist: false })
    // Why "(2)": an agent named "Support Bot" already exists (created above),
    // so the import's own duplicate-name disambiguation kicks in — see the
    // dedicated "disambiguates a duplicate display name" test below for the
    // behavior in isolation.
    expect(result.displayName).toBe('Support Bot (2)')
    expect(result.personaId).not.toBe(agent.id) // brand-new agent, not the source
    expect(result.newPubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(result.memoryWritten).toBe(0)
    expect(result.memoryTotal).toBe(0)

    // export_agent_snapshot: writes the file via the (mocked) native dialog.
    const saved = await exportAgentSnapshot({ id: agent.id, memoryLevel: 'none', format: 'json' })
    expect(saved).toBe(true)
    const onDisk = JSON.parse(readFileSync(testState.savedPath!, 'utf-8'))
    expect(onDisk.displayName).toBe('Support Bot')
  })

  it('round-trips a png-format snapshot', async () => {
    const { createAgent } = await import('../../agents/agents-store')
    const { encodeAgentSnapshotForSend, previewAgentSnapshotImport } = await import('./agent-snapshot')
    const agent = createAgent({ name: 'PNG Agent', systemPrompt: 'x', engine: 'claude', model: 'm' }).at(-1)!
    const encoded = encodeAgentSnapshotForSend({ id: agent.id, memoryLevel: 'none', format: 'png' })
    expect(encoded.fileName).toMatch(/\.png$/)
    expect(Buffer.from(encoded.fileBytes.slice(0, 8))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const preview = previewAgentSnapshotImport(encoded.fileBytes)
    expect(preview.displayName).toBe('PNG Agent')
  })

  it('exportAgentSnapshot returns false when the user cancels the save dialog', async () => {
    const { createAgent } = await import('../../agents/agents-store')
    const { exportAgentSnapshot } = await import('./agent-snapshot')
    const agent = createAgent({ name: 'X', systemPrompt: '', engine: 'claude', model: 'm' }).at(-1)!
    testState.canceled = true
    const saved = await exportAgentSnapshot({ id: agent.id, memoryLevel: 'none', format: 'json' })
    expect(saved).toBe(false)
  })

  it('throws for export/encode of a missing agent', async () => {
    const { exportAgentSnapshot, encodeAgentSnapshotForSend } = await import('./agent-snapshot')
    await expect(exportAgentSnapshot({ id: 'ghost', memoryLevel: 'none', format: 'json' })).rejects.toThrow(
      /Agent not found/
    )
    expect(() => encodeAgentSnapshotForSend({ id: 'ghost', memoryLevel: 'none', format: 'json' })).toThrow(
      /Agent not found/
    )
  })

  it('rejects an empty/malformed snapshot file cleanly (never throws unhandled, never crashes)', async () => {
    const { previewAgentSnapshotImport, confirmAgentSnapshotImport } = await import('./agent-snapshot')
    expect(() => previewAgentSnapshotImport([])).toThrow(/Snapshot file is empty/)
    expect(() => previewAgentSnapshotImport(Array.from(Buffer.from('not json')))).toThrow(/not valid JSON/)
    expect(() =>
      previewAgentSnapshotImport(Array.from(Buffer.from(JSON.stringify({ magic: 'wrong-magic', version: 1 }))))
    ).toThrow(/Unrecognized snapshot type/)
    expect(() =>
      confirmAgentSnapshotImport({
        fileBytes: Array.from(Buffer.from(JSON.stringify({ magic: 'buzz-agent-snapshot', version: 1 }))),
        keepAllowlist: false
      })
    ).toThrow(/missing a display name/)
  })

  it('never embeds a token/key-shaped accountId in an exported snapshot', async () => {
    const { createAgent } = await import('../../agents/agents-store')
    const { encodeAgentSnapshotForSend } = await import('./agent-snapshot')
    const agent = createAgent({
      name: 'Has Secret Looking Account',
      systemPrompt: '',
      engine: 'claude',
      model: 'm',
      accountId: 'sk-thisIsNotAllowedToLeaveTheDevice1234567890'
    }).at(-1)!
    const encoded = encodeAgentSnapshotForSend({ id: agent.id, memoryLevel: 'none', format: 'json' })
    const text = Buffer.from(encoded.fileBytes).toString('utf-8')
    expect(text).not.toContain('sk-thisIsNotAllowedToLeaveTheDevice1234567890')
    const envelope = JSON.parse(text)
    expect(envelope.accountId).toBeNull()
  })

  it('carries a genuinely safe (opaque uuid-shaped) accountId through as an id only', async () => {
    const { createAgent } = await import('../../agents/agents-store')
    const { encodeAgentSnapshotForSend } = await import('./agent-snapshot')
    const agent = createAgent({
      name: 'Bound Agent',
      systemPrompt: '',
      engine: 'claude',
      model: 'm',
      accountId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    }).at(-1)!
    const encoded = encodeAgentSnapshotForSend({ id: agent.id, memoryLevel: 'none', format: 'json' })
    const envelope = JSON.parse(Buffer.from(encoded.fileBytes).toString('utf-8'))
    expect(envelope.accountId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
  })

  it('does not carry an imported snapshot\'s accountId onto the newly created local agent', async () => {
    const { getAgent } = await import('../../agents/agents-store')
    const { confirmAgentSnapshotImport } = await import('./agent-snapshot')
    const envelope = {
      magic: 'buzz-agent-snapshot',
      version: 1,
      displayName: 'Imported',
      systemPrompt: 'x',
      model: 'm',
      runtime: 'claude',
      accountId: 'some-senders-account-id',
      avatarUrl: null,
      respondToAllowlist: [],
      memoryLevel: 'none'
    }
    const result = confirmAgentSnapshotImport({
      fileBytes: Array.from(Buffer.from(JSON.stringify(envelope))),
      keepAllowlist: false
    })
    const created = getAgent(result.personaId)
    expect(created?.accountId ?? null).toBeNull()
  })

  it('disambiguates a duplicate display name on repeated import', async () => {
    const { confirmAgentSnapshotImport } = await import('./agent-snapshot')
    const bytes = Array.from(
      Buffer.from(
        JSON.stringify({
          magic: 'buzz-agent-snapshot',
          version: 1,
          displayName: 'Dup',
          systemPrompt: '',
          model: 'm',
          runtime: 'claude',
          accountId: null,
          avatarUrl: null,
          respondToAllowlist: [],
          memoryLevel: 'none'
        })
      )
    )
    const first = confirmAgentSnapshotImport({ fileBytes: bytes, keepAllowlist: false })
    const second = confirmAgentSnapshotImport({ fileBytes: bytes, keepAllowlist: false })
    expect(first.displayName).toBe('Dup')
    expect(second.displayName).toBe('Dup (2)')
  })
})
