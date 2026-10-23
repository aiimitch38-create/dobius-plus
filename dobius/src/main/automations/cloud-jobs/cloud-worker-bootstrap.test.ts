import { chmodSync, lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConfiguredCloudWorkerHostFactory } from './cloud-worker-bootstrap'
import { configuredWorkerFixture } from './cloud-worker-bootstrap.fixtures'
import { assertWorkerPrerequisites } from './cloud-worker-bootstrap-validation'
import { readPrivateWorkerConfig } from './cloud-worker-config-file'
import { CloudWorkerQueuePort } from './cloud-worker-queue-port'

const workerConstruction = vi.hoisted(() => ({ options: [] as unknown[] }))
vi.mock('../workstation-worker/worker', () => ({
  WorkstationWorker: class {
    constructor(options: unknown) {
      workerConstruction.options.push(options)
    }
    async reconcile() {
      return 'idle'
    }
    observePrivateLease() {
      return { kind: 'fresh' }
    }
    async runClaim() {}
    async cancel() {}
  }
}))

const fixtures: ReturnType<typeof configuredWorkerFixture>[] = []
afterEach(() => {
  workerConstruction.options.length = 0
  for (const fixture of fixtures.splice(0)) {
    fixture.cleanup()
  }
})
function fixture() {
  const result = configuredWorkerFixture()
  fixtures.push(result)
  return result
}

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 1_000
  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(check()).toBe(true)
}

describe('configured two-Hermes cloud worker bootstrap', () => {
  it('returns no factory when configuration is absent, disabled, authority unavailable, or capacity is not injected', () => {
    const absent = fixture()
    rmSync(join(absent.baseDirectory, 'workers.json'))
    expect(
      createConfiguredCloudWorkerHostFactory(absent.context, absent.readCapacity)
    ).toBeUndefined()

    const disabled = fixture()
    disabled.writeConfig({ schemaVersion: 1, enabled: false })
    expect(
      createConfiguredCloudWorkerHostFactory(disabled.context, disabled.readCapacity)
    ).toBeUndefined()

    const noCapacity = fixture()
    expect(createConfiguredCloudWorkerHostFactory(noCapacity.context, undefined)).toBeUndefined()

    const noAuthorityCallback = fixture()
    expect(
      createConfiguredCloudWorkerHostFactory(
        {
          ...noAuthorityCallback.context,
          authorityAvailable: () => {
            throw new Error('unavailable')
          }
        },
        noAuthorityCallback.readCapacity
      )
    ).toBeUndefined()

    const noAuthority = fixture()
    expect(
      createConfiguredCloudWorkerHostFactory(
        { ...noAuthority.context, authorityAvailable: () => false },
        noAuthority.readCapacity
      )
    ).toBeUndefined()
  })

  it('rejects malformed, permissive, symlinked, duplicate-profile and caller-mismatched configuration', () => {
    const malformed = fixture()
    malformed.writeConfig({ ...malformed.config, command: 'caller-controlled' })
    expect(() =>
      createConfiguredCloudWorkerHostFactory(malformed.context, malformed.readCapacity)
    ).toThrow(/invalid or untrusted/)

    const linked = fixture()
    const configPath = join(linked.baseDirectory, 'workers.json')
    const target = join(linked.baseDirectory, 'workers-target.json')
    writeFileSync(target, JSON.stringify(linked.config), { mode: 0o600 })
    chmodSync(target, 0o600)
    rmSync(configPath)
    symlinkSync(target, configPath)
    expect(() =>
      createConfiguredCloudWorkerHostFactory(linked.context, linked.readCapacity)
    ).toThrow(/invalid or untrusted/)

    const duplicate = fixture()
    duplicate.writeConfig({
      ...duplicate.config,
      profiles: [
        duplicate.config.profiles[0],
        { ...duplicate.config.profiles[1], home: duplicate.config.profiles[0].home }
      ]
    })
    expect(() =>
      createConfiguredCloudWorkerHostFactory(duplicate.context, duplicate.readCapacity)
    ).toThrow(/invalid or untrusted/)

    const mismatch = fixture()
    const otherProject = { ...mismatch.context.projects[0]!, root: '/not-the-enrolled-root' }
    expect(() =>
      createConfiguredCloudWorkerHostFactory(
        { ...mismatch.context, projects: [otherProject] },
        mismatch.readCapacity
      )
    ).toThrow(/configuration or enrolled prerequisites/)

    const insecure = fixture()
    chmodSync(join(insecure.baseDirectory, 'workers.json'), 0o644)
    expect(() =>
      createConfiguredCloudWorkerHostFactory(insecure.context, insecure.readCapacity)
    ).toThrow(/invalid or untrusted/)
  })

  it('rejects a private Hermes home that is the same physical directory as an enrolled root before writes', () => {
    const f = fixture()
    chmodSync(f.config.roots[0]!.canonicalPath, 0o700)
    const profiles = [...f.config.profiles]
    profiles[0] = { ...profiles[0]!, home: f.config.roots[0]!.canonicalPath }
    f.writeConfig({ ...f.config, profiles })
    const config = readPrivateWorkerConfig(f.baseDirectory).config
    if (!config.enabled) {
      throw new Error('Fixture config unexpectedly disabled.')
    }

    expect(() => assertWorkerPrerequisites(f.baseDirectory, config)).toThrow(
      /homes cannot alias an enrolled project root/
    )
    expect(() => createConfiguredCloudWorkerHostFactory(f.context, f.readCapacity)).toThrow(
      /configuration or enrolled prerequisites are invalid/
    )
    expect(() => lstatSync(join(f.baseDirectory, 'worker-state'))).toThrow()
    expect(() => lstatSync(join(f.baseDirectory, 'worker-coordination'))).toThrow()
  })

  it('rejects a private Hermes home nested under an enrolled root before worker-state writes', () => {
    const f = fixture()
    const nestedHome = join(f.config.roots[0]!.canonicalPath, 'nested-profile-home')
    mkdirSync(nestedHome, { mode: 0o700 })
    const profiles = [...f.config.profiles]
    profiles[0] = { ...profiles[0]!, home: nestedHome }
    f.writeConfig({ ...f.config, profiles })
    const config = readPrivateWorkerConfig(f.baseDirectory).config
    if (!config.enabled) {
      throw new Error('Fixture config unexpectedly disabled.')
    }

    expect(() => assertWorkerPrerequisites(f.baseDirectory, config)).toThrow(
      /Credential homes must not overlap enrolled source directories/
    )
    expect(() => createConfiguredCloudWorkerHostFactory(f.context, f.readCapacity)).toThrow(
      /configuration or enrolled prerequisites are invalid/
    )
    expect(() => lstatSync(join(f.baseDirectory, 'worker-state'))).toThrow()
    expect(() => lstatSync(join(f.baseDirectory, 'worker-coordination'))).toThrow()
  })

  it('rejects an enrolled execution worktree that aliases its origin root before writes', () => {
    const f = fixture()
    const worktrees = [...f.config.worktrees]
    worktrees[0] = { ...worktrees[0]!, canonicalPath: f.config.roots[0]!.canonicalPath }
    f.writeConfig({ ...f.config, worktrees })
    const config = readPrivateWorkerConfig(f.baseDirectory).config
    if (!config.enabled) {
      throw new Error('Fixture config unexpectedly disabled.')
    }

    expect(() => assertWorkerPrerequisites(f.baseDirectory, config)).toThrow(
      /worktrees cannot alias an enrolled root/
    )
    expect(() => createConfiguredCloudWorkerHostFactory(f.context, f.readCapacity)).toThrow(
      /configuration or enrolled prerequisites are invalid/
    )
    expect(() => lstatSync(join(f.baseDirectory, 'worker-state'))).toThrow()
    expect(() => lstatSync(join(f.baseDirectory, 'worker-coordination'))).toThrow()
  })

  it('constructs an inert host, then recovers with dispatch paused and checks fresh capacity on eligibility reads', async () => {
    const f = fixture()
    const now = () => Date.now()
    const createHost = createConfiguredCloudWorkerHostFactory(f.context, f.readCapacity, { now })
    expect(createHost).toBeTypeOf('function')
    const host = createHost!(f.store)
    expect(host.snapshot().map((slot) => slot.state)).toEqual(['unrecovered', 'unrecovered'])
    expect(workerConstruction.options).toHaveLength(2)
    expect(host.executorEligibility).toBe(false)
    expect(f.store.isDispatchEnabled()).toBe(false)

    await host.start()
    expect(host.snapshot().map((slot) => slot.state)).toEqual(['idle', 'idle'])
    expect(host.executorEligibility).toBe(true)
    expect(f.store.isDispatchEnabled()).toBe(false)
    expect(f.capacityReads).toBeGreaterThanOrEqual(2)
    const workerOptions = workerConstruction.options as { queue: unknown }[]
    expect(workerOptions).toHaveLength(2)
    expect(workerOptions.every(({ queue }) => queue instanceof CloudWorkerQueuePort)).toBe(true)
    expect(workerOptions[0]!.queue).not.toBe(workerOptions[1]!.queue)

    f.setCapacityAvailable(false)
    expect(host.executorEligibility).toBe(false)
    f.setCapacityAvailable(true)
    expect(host.executorEligibility).toBe(true)
    f.setAuthorityAvailable(false)
    expect(host.executorEligibility).toBe(false)
    f.setAuthorityAvailable(true)
    expect(host.executorEligibility).toBe(true)
    expect(await host.stop(5_000)).toEqual({ drained: true })
  })

  it('revokes eligibility when the private config generation changes or capacity becomes stale', async () => {
    const f = fixture()
    let now = Date.now()
    const hostFactory = createConfiguredCloudWorkerHostFactory(f.context, f.readCapacity, {
      now: () => now
    })!
    const host = hostFactory(f.store)
    await host.start()
    expect(host.executorEligibility).toBe(true)

    f.writeConfig(f.config)
    expect(host.executorEligibility).toBe(false)
    expect(await host.stop(5_000)).toEqual({ drained: true })

    const stale = fixture()
    now = Date.now()
    const staleFactory = createConfiguredCloudWorkerHostFactory(stale.context, stale.readCapacity, {
      now: () => now,
      pollIntervalMs: 10
    })!
    const staleHost = staleFactory(stale.store)
    await staleHost.start()
    expect(staleHost.executorEligibility).toBe(true)
    now += 5_001
    expect(staleHost.executorEligibility).toBe(false)
    expect(await staleHost.stop(5_000)).toEqual({ drained: true })
  })

  it('does not let the returned store factory bind a second database', () => {
    const f = fixture()
    const factory = createConfiguredCloudWorkerHostFactory(f.context, f.readCapacity)!
    const host = factory(f.store)
    const another = fixture()
    expect(() => factory(another.store)).toThrow(/different store/)
    expect(host.snapshot().map((slot) => slot.state)).toEqual(['unrecovered', 'unrecovered'])
    expect(lstatSync(join(f.baseDirectory, 'worker-state', 'worker-1')).isDirectory()).toBe(true)
    expect(workerConstruction.options).toHaveLength(2)
  })

  it('refuses capacity samples that omit explicit external reservations', () => {
    const f = fixture()
    const factory = createConfiguredCloudWorkerHostFactory(f.context, (deviceId) => {
      const sample = f.readCapacity(deviceId) as Record<string, unknown>
      delete sample.externalReservedBytes
      return sample as never
    })!
    const host = factory(f.store)
    return host.start().then(async () => {
      expect(host.executorEligibility).toBe(false)
      expect(workerConstruction.options).toHaveLength(2)
      expect(await host.stop(5_000)).toEqual({ drained: true })
    })
  })

  it('keeps the host attached but ineligible while the injected capacity source is unavailable', async () => {
    const f = fixture()
    f.setCapacityAvailable(false)
    const factory = createConfiguredCloudWorkerHostFactory(f.context, f.readCapacity, {
      pollIntervalMs: 10
    })!
    const host = factory(f.store)
    await host.start()
    expect(host.executorEligibility).toBe(false)
    expect(host.snapshot().map((slot) => slot.state)).toEqual(['idle', 'idle'])
    f.setCapacityAvailable(true)
    await waitFor(() => host.executorEligibility)
    expect(host.executorEligibility).toBe(true)
    expect(await host.stop(5_000)).toEqual({ drained: true })
  })
})
