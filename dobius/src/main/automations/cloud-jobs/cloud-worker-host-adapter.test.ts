import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { hostFixture, leaseOf } from './cloud-worker-host-adapter.fixtures'

const fixtures: ReturnType<typeof hostFixture>[] = []
afterEach(() => fixtures.splice(0).forEach((fixture) => fixture.cleanup()))
function fixture() {
  const result = hostFixture()
  fixtures.push(result)
  return result
}

describe('single-store private worker host callbacks', () => {
  it('requires exact private journal tokens after reopening; absence never clears outstanding work', async () => {
    const f = fixture()
    const claim = await f.claim()
    f.reopen()
    const host = f.callbacks()
    expect(await host.readActiveLease('worker-1')).toEqual({ kind: 'unknown' })
    expect(await host.readActiveLease('worker-2')).toEqual({ kind: 'idle' })
    expect(await host.readActiveLease('other')).toEqual({ kind: 'unknown' })
    f.observation.set('worker-1', {
      kind: 'active',
      lease: { ...leaseOf(claim), token: 'x'.repeat(64) }
    })
    expect(await host.readActiveLease('worker-1')).toEqual({ kind: 'unknown' })
    f.observation.set('worker-1', { kind: 'active', lease: leaseOf(claim) })
    expect(await host.readActiveLease('worker-1')).toEqual({
      kind: 'active',
      lease: leaseOf(claim)
    })
    for (const suffix of ['', '-wal']) {
      expect(readFileSync(f.database + suffix).includes(Buffer.from(claim.token))).toBe(false)
    }
    expect(f.reserved()).toBe(100)
  })

  it('keeps corrupt or falsely settled journals uncertain and requires durable no-attempt proof for idle', async () => {
    const f = fixture()
    const claim = await f.claim()
    const host = f.callbacks()
    for (const kind of ['unknown', 'idle', 'fresh'] as const) {
      f.observation.set('worker-1', { kind })
      expect(await host.readActiveLease('worker-1')).toEqual({ kind: 'unknown' })
    }
    f.observation.set('worker-2', { kind: 'unknown' })
    expect(await host.readActiveLease('worker-2')).toEqual({ kind: 'unknown' })
    expect(await host.cancelUnstartedClaim(claim)).toMatchObject({ confirmed: true })
    f.observation.set('worker-1', { kind: 'idle' })
    expect(await host.readActiveLease('worker-1')).toEqual({ kind: 'idle' })
  })

  it('atomically withdraws only an exact unstarted claim and requeues it without another attempt or reservation', async () => {
    const f = fixture()
    const claim = await f.claim()
    const host = f.callbacks()
    const bad = { ...claim, token: 'x'.repeat(64) }
    expect(await host.cancelUnstartedClaim(bad)).toEqual({ confirmed: false })
    expect(f.reserved()).toBe(100)
    expect(await host.cancelUnstartedClaim(claim)).toEqual({
      confirmed: true,
      attemptId: claim.attemptId,
      workerId: claim.workerId,
      token: claim.token
    })
    expect(f.store.get(claim.job.id).state).toBe('queued')
    expect(f.reserved()).toBe(0)
    expect(await host.cancelUnstartedClaim(claim)).toEqual({ confirmed: false })
    const next = await f.port().claim('worker-1')
    expect(next?.job.id).toBe(claim.job.id)
    expect(next?.attemptId).not.toBe(claim.attemptId)
  })

  it('preserves explicit user cancellation when withdrawing an unstarted claim', async () => {
    const f = fixture()
    const claim = await f.claim()
    const host = f.callbacks()
    const job = f.store.get(claim.job.id)
    f.store.cancel(job.id, job.version)
    expect(await host.cancelUnstartedClaim(claim)).toMatchObject({ confirmed: true })
    expect(f.store.get(job.id).state).toBe('cancelled')
    expect(f.reserved()).toBe(0)
    expect(await f.port().claim('worker-1')).toBeNull()
  })

  it('refuses withdrawal as soon as a start permit exists, even before the process receipt', async () => {
    const f = fixture()
    const claim = await f.claim()
    const host = f.callbacks()
    await f.permit(claim)
    expect(await host.cancelUnstartedClaim(claim)).toEqual({ confirmed: false })
    expect(f.reserved()).toBe(100)
    expect(f.store.get(claim.job.id).state).toBe('running')
  })

  it('records exact idempotent shutdown intent and retains capacity until a bound stop receipt', async () => {
    const f = fixture()
    const claim = await f.claim()
    const host = f.callbacks()
    const lease = leaseOf(claim)
    await f.permit(claim)
    const identity = {
      pid: 5001,
      processStart: 'synthetic-start',
      processGroupId: 5001,
      bootId: 'fixture-boot',
      incarnation: 'fixture-incarnation'
    }
    await f.port().acknowledgeStarted(lease, identity)
    expect(await host.observeCancellation(lease)).toEqual({ kind: 'not-stopping', lease })
    expect(await host.requestActiveCancellation({ ...lease, token: 'x'.repeat(64) })).toEqual({
      confirmed: false
    })
    expect(f.store.get(claim.job.id).state).toBe('running')
    expect(await host.requestActiveCancellation(lease)).toMatchObject({ confirmed: true })
    const version = f.store.get(claim.job.id).version
    expect(await host.requestActiveCancellation(lease)).toMatchObject({ confirmed: true })
    expect(f.store.get(claim.job.id).version).toBe(version)
    expect(await host.observeCancellation(lease)).toEqual({ kind: 'stopping', lease })
    expect(f.reserved()).toBe(100)
    const proof = {
      attemptId: claim.attemptId,
      workerId: claim.workerId,
      processGroupId: 5001,
      observedAt: 100_000,
      descendantsAbsent: true as const,
      containment: 'posix-process-group' as const
    }
    await expect(
      f.port().acknowledgeStopped(lease, { ...proof, processGroupId: 5002 })
    ).rejects.toThrow('process group')
    expect(f.reserved()).toBe(100)
    await f.port().acknowledgeStopped(lease, proof)
    expect(f.reserved()).toBe(0)
    expect(await host.observeCancellation(lease)).toEqual({ kind: 'unknown' })
    f.reopen()
    expect(f.reserved()).toBe(0)
  })

  it('observes expired and interrupted exact leases as stopping and holds their reservations', async () => {
    const f = fixture()
    const claim = await f.claim()
    const lease = leaseOf(claim)
    const host = f.callbacks()
    f.advance(60_001)
    expect(await host.observeCancellation(lease)).toEqual({ kind: 'stopping', lease })
    f.store.reconcileExpired()
    expect(await host.observeCancellation(lease)).toEqual({ kind: 'stopping', lease })
    expect(f.reserved()).toBe(100)
    expect(await host.observeCancellation({ ...lease, workerId: 'other' })).toEqual({
      kind: 'unknown'
    })
    expect(await host.requestActiveCancellation({ ...lease, workerId: 'other' })).toEqual({
      confirmed: false
    })
  })

  it('makes both enrolled workers consume the same transactional capacity ledger', async () => {
    const f = fixture()
    const a = await f.claim()
    const b = await f.claim('worker-2', 'second')
    const host = f.callbacks()
    f.observation.set('worker-1', { kind: 'active', lease: leaseOf(a) })
    f.observation.set('worker-2', { kind: 'active', lease: leaseOf(b) })
    expect((await host.readActiveLease('worker-1')).kind).toBe('active')
    expect((await host.readActiveLease('worker-2')).kind).toBe('active')
    expect(f.reserved()).toBe(200)
    await host.requestActiveCancellation(leaseOf(a))
    expect(f.reserved()).toBe(200)
    expect(await f.port().claim('worker-1')).toBeNull()
  })
})
