import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { realWorkerHostFixture } from './cloud-worker-real-host.fixtures'

const fixtures: ReturnType<typeof realWorkerHostFixture>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.cleanup()
  }
})
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Actual worker fixture exceeded bounded wait')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('two-slot host with actual workers and one SQLite authority', () => {
  it('withdraws a rejected pre-permit claim only through the exact durable no-start guard', async () => {
    const f = realWorkerHostFixture('process.exit(0)', { invalidRecipe: true })
    fixtures.push(f)
    const job = f.submit('reject-before-permit')
    await f.host.start()
    f.store.setDispatchEnabled(true)
    await waitFor(
      () =>
        f.store.db.prepare("SELECT id FROM cloud_attempts WHERE status='cancelled_unstarted'").all()
          .length > 0
    )
    f.store.setDispatchEnabled(false)
    expect(await f.host.stop(5_000)).toEqual({ drained: true })
    expect(f.store.get(job.id).state).toBe('queued')
    expect(f.store.db.prepare('SELECT * FROM cloud_worker_permits').all()).toEqual([])
    expect(f.store.db.prepare('SELECT * FROM cloud_worker_starts').all()).toEqual([])
    expect(f.store.db.prepare('SELECT * FROM cloud_capacity_reservations').all()).toEqual([])
    for (let index = 0; index < 2; index++) {
      expect(existsSync(join(f.base, `state-${index}`, 'attempt.json'))).toBe(false)
    }
  }, 15_000)

  it('recovers paused, executes both exact worktrees, and settles each child to review', async () => {
    const f = realWorkerHostFixture("setTimeout(() => { process.stdout.write('synthetic'); }, 300)")
    fixtures.push(f)
    const jobs = [f.submit('one'), f.submit('two')]
    await f.host.start()
    expect(f.host.executorEligibility).toBe(true)
    expect(f.store.list().every((job) => job.state === 'queued')).toBe(true)
    f.store.setDispatchEnabled(true)
    await waitFor(() => jobs.every((job) => f.store.get(job.id).state === 'needs_review'))
    expect(
      f.store.db
        .prepare('SELECT worker FROM cloud_attempts')
        .all()
        .map((row) => row.worker)
        .sort()
    ).toEqual(['worker-0', 'worker-1'])
    expect(f.store.db.prepare('SELECT * FROM cloud_capacity_reservations').all()).toEqual([])
    for (let index = 0; index < 2; index++) {
      const journal = readFileSync(join(f.base, `state-${index}`, 'attempt.json'), 'utf8')
      expect(JSON.parse(journal).phase).toBe('settled')
      expect(journal).toContain('sealed:v1:')
    }
    expect(jobs.every((job) => f.store.get(job.id).state !== 'completed')).toBe(true)
    expect(await f.host.stop(5_000)).toEqual({ drained: true })
    expect(f.store.list()).toHaveLength(2)
  }, 15_000)

  it('records exact stop proof for both running process groups before releasing reservations', async () => {
    const f = realWorkerHostFixture('setInterval(() => {}, 1000)')
    fixtures.push(f)
    f.submit('one')
    f.submit('two')
    await f.host.start()
    f.store.setDispatchEnabled(true)
    await waitFor(() => f.store.db.prepare('SELECT * FROM cloud_worker_starts').all().length === 2)
    expect(f.store.db.prepare('SELECT * FROM cloud_capacity_reservations').all()).toHaveLength(2)
    expect(await f.host.stop(5_000)).toEqual({ drained: true })
    expect(f.host.executorEligibility).toBe(false)
    expect(f.store.db.prepare('SELECT * FROM cloud_capacity_reservations').all()).toEqual([])
    expect(
      f.store.db
        .prepare('SELECT status FROM cloud_attempts')
        .all()
        .every((row) => row.status !== 'running')
    ).toBe(true)
    for (let index = 0; index < 2; index++) {
      expect(
        JSON.parse(readFileSync(join(f.base, `state-${index}`, 'attempt.json'), 'utf8')).phase
      ).toBe('settled')
    }
  }, 15_000)
})
