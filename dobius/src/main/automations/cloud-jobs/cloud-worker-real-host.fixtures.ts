import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HermesProfileRegistration } from '../../../shared/workstation-worker'
import { WorkstationWorker } from '../workstation-worker/worker'
import { openDurableLeaseSealer } from '../workstation-worker/lease-sealer'
import type { WorkerRegistry } from '../workstation-worker/registry'
import { CloudJobStore } from './store'
import { createCloudWorkerHostRuntime } from './cloud-worker-host-runtime'

/** Synthetic Node executors exercise actual workers; no Hermes/provider is invoked. */
export function realWorkerHostFixture(source: string, options: { invalidRecipe?: boolean } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'dobius-real-host-')))
  const root = join(base, 'repo')
  mkdirSync(root)
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'user.name', 'Fixture')
  writeFileSync(join(root, 'fixture.txt'), 'Synthetic source only\n')
  git('add', 'fixture.txt')
  git('commit', '-qm', 'fixture')
  const revision = git('rev-parse', 'HEAD')
  const executorScript = join(base, 'synthetic-executor.cjs')
  writeFileSync(executorScript, source)
  const profiles: HermesProfileRegistration[] = ['hermes-1', 'hermes-2'].map((id, index) => {
    const worktree = join(base, `worktree-${index}`)
    git('worktree', 'add', '--quiet', '--detach', worktree, revision)
    const home = join(base, `profile-${index}`)
    mkdirSync(home, { mode: 0o700 })
    return {
      id: id as HermesProfileRegistration['id'],
      home,
      worktreeId: `worktree-${index}`,
      allowedRoots: ['root'],
      allowedRecipes: ['verify'],
      credentialRef: 'synthetic-no-provider',
      authVerified: true,
      runtimeVerified: true
    }
  })
  const caps = {
    wallTimeMs: 10_000,
    outputBytes: 4096,
    artifactBytes: 0,
    memoryBytes: 512 * 1024 ** 2,
    cpuCount: 1
  }
  const store = new CloudJobStore(join(base, 'jobs.sqlite'), Date.now, { localDeviceId: 'device' })
  store.registerProject({
    id: 'project',
    deviceId: 'device',
    root,
    recipes: ['verify'],
    capability: 'portable'
  })
  store.setDispatchEnabled(false)
  const host = createCloudWorkerHostRuntime({
    store,
    pollIntervalMs: 20,
    readAuthority: () => ({ ready: true }),
    readCapacity: () => ({
      freeBytes: 10 ** 12,
      externalReservedBytes: 0,
      safetyBytes: 100,
      sampledAt: Date.now()
    }),
    slots: profiles.map((profile, index) => ({
      enrollment: {
        workerId: `worker-${index}`,
        deviceId: 'device',
        capabilities: ['portable'],
        assignments: [
          {
            projectId: 'project',
            recipeId: 'verify',
            rootId: 'root',
            worktreeId: profile.worktreeId,
            profileId: profile.id,
            minimumWorkingBytes: 0,
            caps
          }
        ]
      },
      createWorker(queue) {
        const registry: WorkerRegistry = {
          workerId: `worker-${index}`,
          deviceId: 'device',
          profiles,
          roots: [
            {
              id: 'root',
              canonicalPath: root,
              allowedRecipes: ['verify'],
              allowedWorktrees: profiles.map((p) => p.worktreeId)
            }
          ],
          worktrees: profiles.map((p) => ({
            id: p.worktreeId,
            rootId: 'root',
            canonicalPath: join(base, p.worktreeId)
          })),
          recipes: [
            {
              id: 'verify',
              executable: process.execPath,
              argv: options.invalidRecipe
                ? ['{unsupported-fixture-placeholder}']
                : [executorScript],
              maxCaps: caps,
              hermesProfileId: profile.id
            }
          ]
        }
        const state = join(base, `state-${index}`)
        mkdirSync(state, { mode: 0o700 })
        const statePath = join(state, 'attempt.json')
        return new WorkstationWorker({
          registry,
          statePath,
          coordinationPath: join(base, 'coordination'),
          queue,
          leaseSealer: openDurableLeaseSealer({ stateDirectory: state, journalPath: statePath }),
          heartbeatMs: 25
        })
      }
    }))
  })
  return {
    base,
    store,
    host,
    submit(key: string) {
      return store.submit(
        {
          requestKey: key,
          taskId: `task-${key}`,
          projectId: 'project',
          workspaceId: 'workspace',
          targetDeviceId: 'device',
          recipeId: 'verify',
          title: 'Synthetic actual-process fixture',
          sourceRevision: revision,
          estimatedBytes: 10,
          dependencies: []
        },
        'fixture'
      )
    },
    async cleanup() {
      const receipt = await host.stop(5_000)
      if (!receipt.drained) {
        throw new Error(`Unproven test drain; preserve fixture at ${base}`)
      }
      store.close()
      rmSync(base, { recursive: true, force: true })
    }
  }
}
