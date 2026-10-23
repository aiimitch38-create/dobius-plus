import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CloudProject } from '../../../shared/cloud-jobs'
import type { CloudWorkerCapacitySample } from '../../../shared/cloud-worker-enrollment'
import { CloudJobStore } from './store'

const caps = {
  wallTimeMs: 10_000,
  outputBytes: 4096,
  artifactBytes: 0,
  memoryBytes: 512 * 1024 ** 2,
  cpuCount: 1
}

export function configuredWorkerFixture() {
  const baseDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'dobius-worker-bootstrap-')))
  chmodSync(baseDirectory, 0o700)
  const repository = join(baseDirectory, 'repository')
  const worktrees = [join(baseDirectory, 'worktree-one'), join(baseDirectory, 'worktree-two')]
  mkdirSync(repository)
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'user.name', 'Fixture')
  writeFileSync(join(repository, 'fixture.txt'), 'Synthetic source only\n')
  git('add', 'fixture.txt')
  git('commit', '-qm', 'fixture')
  const revision = git('rev-parse', 'HEAD')
  for (const worktree of worktrees) {
    git('worktree', 'add', '--quiet', '--detach', worktree, revision)
  }
  const homes = ['hermes-1', 'hermes-2'].map((id) => join(baseDirectory, `profile-${id}`))
  for (const home of homes) {
    mkdirSync(home, { mode: 0o700 })
  }
  const project: CloudProject = {
    id: 'project-one',
    deviceId: 'device-one',
    root: repository,
    recipes: ['verify-one', 'verify-two'],
    capability: 'portable'
  }
  const config = {
    schemaVersion: 1,
    enabled: true,
    deviceId: project.deviceId,
    projectBindings: [{ projectId: project.id, rootId: 'root-one' }],
    roots: [
      {
        id: 'root-one',
        canonicalPath: repository,
        allowedRecipes: ['verify-one', 'verify-two'],
        allowedWorktrees: ['worktree-one', 'worktree-two']
      }
    ],
    worktrees: worktrees.map((canonicalPath, index) => ({
      id: `worktree-${index === 0 ? 'one' : 'two'}`,
      rootId: 'root-one',
      canonicalPath
    })),
    recipes: ['hermes-1', 'hermes-2'].map((hermesProfileId, index) => ({
      id: `verify-${index === 0 ? 'one' : 'two'}`,
      executable: realpathSync(process.execPath),
      argv: ['-e', 'process.exit(0)'],
      maxCaps: caps,
      hermesProfileId
    })),
    profiles: ['hermes-1', 'hermes-2'].map((id, index) => ({
      id,
      home: homes[index],
      worktreeId: `worktree-${index === 0 ? 'one' : 'two'}`,
      allowedRoots: ['root-one'],
      allowedRecipes: [`verify-${index === 0 ? 'one' : 'two'}`],
      credentialRef: `enrollment-ref-${id}`,
      authVerified: true,
      runtimeVerified: true
    })),
    workers: ['hermes-1', 'hermes-2'].map((profileId, index) => ({
      workerId: `worker-${index + 1}`,
      profileId,
      capabilities: ['portable'],
      assignments: [
        {
          projectId: project.id,
          rootId: 'root-one',
          worktreeId: `worktree-${index === 0 ? 'one' : 'two'}`,
          recipeId: `verify-${index === 0 ? 'one' : 'two'}`,
          minimumWorkingBytes: 0,
          caps
        }
      ]
    }))
  }
  const configPath = join(baseDirectory, 'workers.json')
  const writeConfig = (value: unknown) => {
    writeFileSync(configPath, JSON.stringify(value), { mode: 0o600 })
    chmodSync(configPath, 0o600)
  }
  writeConfig(config)
  const store = new CloudJobStore(join(baseDirectory, 'jobs.sqlite'), Date.now, {
    localDeviceId: project.deviceId
  })
  store.registerProject(project)
  store.setDispatchEnabled(false)
  let now = Date.now()
  let capacityAvailable = true
  let authorityAvailable = true
  let capacityReads = 0
  const readCapacity = (deviceId: string): CloudWorkerCapacitySample => {
    capacityReads += 1
    if (!capacityAvailable || deviceId !== project.deviceId) {
      throw new Error('Synthetic capacity receipt unavailable.')
    }
    return {
      freeBytes: 10 ** 12,
      externalReservedBytes: 0,
      safetyBytes: 100,
      sampledAt: now
    }
  }
  const context = {
    baseDirectory,
    deviceId: project.deviceId,
    projects: [project],
    authorityAvailable: () => authorityAvailable
  }
  return {
    baseDirectory,
    config,
    writeConfig,
    store,
    context,
    readCapacity,
    get capacityReads() {
      return capacityReads
    },
    setCapacityAvailable(value: boolean) {
      capacityAvailable = value
    },
    setAuthorityAvailable(value: boolean) {
      authorityAvailable = value
    },
    advanceClock(ms: number) {
      now += ms
    },
    cleanup() {
      store.close()
      rmSync(baseDirectory, { recursive: true, force: true })
    }
  }
}
