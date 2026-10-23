import { dirname, join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { hostFixture, leaseOf } from '../cloud-jobs/cloud-worker-host-adapter.fixtures'
import { AttemptJournal, createAttemptRecord } from './journal'
import { openDurableLeaseSealer } from './lease-sealer'
import { observeJournalLease } from './lease-observation'

const fixtures: ReturnType<typeof hostFixture>[] = []
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.cleanup()))

describe('private journal lease observation', () => {
  it('distinguishes a new journal, exact decrypted active lease, and explicit settled state', async () => {
    const f = hostFixture()
    fixtures.push(f)
    const claim = await f.claim()
    const path = join(dirname(f.database), 'journal.json')
    const journal = new AttemptJournal(
      path,
      openDurableLeaseSealer({ stateDirectory: dirname(path), journalPath: path })
    )
    expect(observeJournalLease(journal, 'worker-1')).toEqual({ kind: 'fresh' })
    const record = createAttemptRecord(
      claim.job,
      leaseOf(claim),
      dirname(path),
      dirname(path),
      'fixture-incarnation',
      'fixture-boot',
      100_000
    )
    journal.write(record)
    expect(observeJournalLease(journal, 'worker-1')).toEqual({ kind: 'unknown' })
    record.phase = 'running'
    journal.write(record)
    expect(readFileSync(path).includes(Buffer.from(claim.token))).toBe(false)
    expect(observeJournalLease(journal, 'worker-1')).toEqual({
      kind: 'active',
      lease: leaseOf(claim)
    })
    expect(observeJournalLease(journal, 'worker-2')).toEqual({ kind: 'unknown' })
    record.attemptId = 'mismatched'
    journal.write(record)
    expect(observeJournalLease(journal, 'worker-1')).toEqual({ kind: 'unknown' })
    record.attemptId = claim.attemptId
    record.phase = 'settled'
    journal.write(record)
    expect(observeJournalLease(journal, 'worker-1')).toEqual({ kind: 'idle' })
  })

  it('returns unknown on corrupt or tampered encrypted journals rather than treating them as fresh', async () => {
    const f = hostFixture()
    fixtures.push(f)
    const claim = await f.claim()
    const path = join(dirname(f.database), 'journal.json')
    const journal = new AttemptJournal(
      path,
      openDurableLeaseSealer({ stateDirectory: dirname(path), journalPath: path })
    )
    const record = createAttemptRecord(
      claim.job,
      leaseOf(claim),
      dirname(path),
      dirname(path),
      'fixture-incarnation',
      'fixture-boot',
      100_000
    )
    record.phase = 'running'
    journal.write(record)
    const persisted = JSON.parse(readFileSync(path, 'utf8'))
    persisted.lease.token = `sealed:v1:${'x'.repeat(100)}`
    writeFileSync(path, JSON.stringify(persisted))
    expect(observeJournalLease(journal, 'worker-1')).toEqual({ kind: 'unknown' })
    writeFileSync(path, '{broken')
    expect(observeJournalLease(journal, 'worker-1')).toEqual({ kind: 'unknown' })
  })
})
