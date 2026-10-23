import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LayaAdvisoryJournal, type LayaJournalDecision } from './laya-advisory-journal'
import { assertPrivateDirectory, LayaAdvisoryJournalLock } from './laya-advisory-journal-lock'

const directories: string[] = []

function makeJournal(): { journal: LayaAdvisoryJournal; path: string } {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'dobius-laya-journal-'))
  directories.push(directory)
  const path = join(directory, 'advisories.jsonl')
  return { journal: new LayaAdvisoryJournal(path), path }
}

function decision(overrides: Partial<LayaJournalDecision> = {}): LayaJournalDecision {
  return {
    kind: 'decision',
    decisionId: 'decision-1',
    createdAt: 100,
    surface: 'verification',
    requestDigest: 'a'.repeat(64),
    evidenceRefs: ['b'.repeat(64)],
    snapshotRevision: 'job:v1',
    modelSourceRevision: null,
    checkpointRevision: null,
    evaluationReportSha256: null,
    confidence: null,
    elapsedMs: null,
    status: 'unavailable',
    suggestion: null,
    deterministicVeto: null,
    ...overrides
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Laya advisory journal', () => {
  it('rejects relative paths before touching the filesystem', () => {
    expect(() => new LayaAdvisoryJournal('relative/journal.jsonl')).toThrow('must be absolute')
    expect(() => assertPrivateDirectory('.')).toThrow('must be absolute')
  })

  it('holds an exclusive cross-process lock and preserves an unknown busy lock', () => {
    const { journal, path } = makeJournal()
    const release = LayaAdvisoryJournalLock.acquire(path)
    const lockModule = new URL('./laya-advisory-journal-lock.ts', import.meta.url).href
    const script = `
      import { LayaAdvisoryJournalLock } from ${JSON.stringify(lockModule)};
      try {
        LayaAdvisoryJournalLock.acquire(${JSON.stringify(path)});
        process.exitCode = 7;
      } catch (error) {
        if (error.code !== 'EEXIST') process.exitCode = 8;
      }
    `
    try {
      const child = spawnSync(
        process.execPath,
        ['--experimental-strip-types', '--input-type=module', '-e', script],
        { encoding: 'utf8', timeout: 5_000 }
      )
      expect(child.status).toBe(0)
      expect(() => journal.append(decision())).toThrow()
      expect(() => journal.verify()).toThrow()
      expect(() => release()).not.toThrow()
      expect(journal.append(decision()).record.kind).toBe('decision')
    } finally {
      try {
        release()
      } catch {
        // The lock was already released in the assertions above.
      }
    }
  })

  it('does not remove or age out an unknown pre-existing lock', () => {
    const { journal, path } = makeJournal()
    const lockPath = `${path}.lock`
    mkdirSync(lockPath, { mode: 0o700 })
    expect(() => journal.append(decision())).toThrow()
    expect(existsSync(lockPath)).toBe(true)
    rmSync(lockPath, { recursive: true })
  })

  it('persists metadata-only decisions and linked append-only outcomes', () => {
    const { journal, path } = makeJournal()
    const first = journal.append(decision())
    journal.append({
      kind: 'outcome',
      decisionId: 'decision-1',
      at: 101,
      outcome: 'corrected',
      outcomeCode: 'reviewer-disagreed',
      evidenceRef: 'c'.repeat(64)
    })
    expect(journal.verify()).toMatchObject({
      records: 2,
      lastHash: expect.any(String),
      decisionIds: ['decision-1']
    })
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/)
    const persisted = readFileSync(path, 'utf8')
    expect(persisted).not.toContain('private transcript')
  })

  it('rejects orphan outcomes and detects tampering in the hash chain', () => {
    const { journal, path } = makeJournal()
    expect(() =>
      journal.append({
        kind: 'outcome',
        decisionId: 'missing',
        at: 101,
        outcome: 'accepted',
        outcomeCode: null,
        evidenceRef: null
      })
    ).toThrow('existing decision')
    journal.append(decision())
    const original = readFileSync(path, 'utf8')
    writeFileSync(path, original.replace('unavailable', 'abstained'))
    expect(() => journal.verify()).toThrow('hash chain')
  })
})
