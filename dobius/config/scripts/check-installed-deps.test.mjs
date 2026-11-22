import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { findInstalledDepMismatches, lockedVersionWanted, main } from './check-installed-deps.mjs'

const projectDir = path.resolve(import.meta.dirname, '../..')

const lockOf = (dependencies, devDependencies = {}) => ({
  lockfileVersion: '9.0',
  importers: { '.': { dependencies, devDependencies } }
})

describe('lockedVersionWanted', () => {
  it('drops pnpm peer and patch context and reads npm aliases', () => {
    expect(lockedVersionWanted('0.3.201(zod@4.4.3)(react@19.2.5)')).toMatchObject({
      version: '0.3.201'
    })
    expect(lockedVersionWanted('1.1.0(patch_hash=ff68)')).toMatchObject({ version: '1.1.0' })
    expect(lockedVersionWanted('string-width@4.2.3')).toMatchObject({ version: '4.2.3' })
    expect(lockedVersionWanted('@scope/real@2.0.0')).toMatchObject({ version: '2.0.0' })
  })

  it('needs only presence for link: and file: dependencies', () => {
    expect(lockedVersionWanted('link:../shared')).toMatchObject({ presenceOnly: true })
    expect(lockedVersionWanted('file:vendor/x-1.0.0.tgz(react@19.2.5)')).toMatchObject({
      presenceOnly: true,
      label: 'file:vendor/x-1.0.0.tgz'
    })
  })
})

describe('findInstalledDepMismatches (port of Line A #20)', () => {
  const installed = (versions) => (name) => (name in versions ? versions[name] : null)

  it('passes when every direct dependency is installed at its locked version', () => {
    expect(
      findInstalledDepMismatches({
        packageJson: { dependencies: { a: '^1.0.0' }, devDependencies: { b: 'file:vendor/b.tgz' } },
        lockfile: lockOf(
          { a: { specifier: '^1.0.0', version: '1.2.0(zod@4.0.0)' } },
          { b: { specifier: 'file:vendor/b.tgz', version: 'file:vendor/b.tgz' } }
        ),
        readInstalledVersion: installed({ a: '1.2.0', b: '0.0.1' })
      })
    ).toEqual([])
  })

  it('refuses a dependency merged into package.json but never installed', () => {
    expect(
      findInstalledDepMismatches({
        packageJson: { devDependencies: { '@anthropic-ai/claude-agent-sdk': '^0.3.0' } },
        lockfile: lockOf(
          {},
          { '@anthropic-ai/claude-agent-sdk': { specifier: '^0.3.0', version: '0.3.201' } }
        ),
        readInstalledVersion: installed({})
      })
    ).toEqual([
      '@anthropic-ai/claude-agent-sdk: not installed, lockfile has 0.3.201 (run pnpm install)'
    ])
  })

  it('refuses a stale install, a missing lock entry and an outdated lockfile', () => {
    expect(
      findInstalledDepMismatches({
        packageJson: { dependencies: { a: '^1.0.0', b: '^2.0.0', c: '^3.0.0' } },
        lockfile: lockOf({
          a: { specifier: '^1.0.0', version: '1.2.0' },
          c: { specifier: '^2.0.0', version: '2.9.0' }
        }),
        readInstalledVersion: installed({ a: '1.1.0', b: '2.0.0', c: '2.9.0' })
      })
    ).toEqual([
      'a: installed 1.1.0, lockfile has 1.2.0 (run pnpm install)',
      'b: not in pnpm-lock.yaml (run pnpm install)',
      'c: package.json asks for ^3.0.0, pnpm-lock.yaml was made for ^2.0.0 (run pnpm install)'
    ])
  })

  it('reports an unreadable installed manifest instead of passing it', () => {
    expect(
      findInstalledDepMismatches({
        packageJson: { dependencies: { a: '^1.0.0' } },
        lockfile: lockOf({ a: { specifier: '^1.0.0', version: '1.0.0' } }),
        readInstalledVersion: () => {
          throw Object.assign(new Error('denied'), { code: 'EACCES' })
        }
      })
    ).toEqual(['a: installed package.json is unreadable (EACCES)'])
  })
})

describe('check-installed-deps main', () => {
  it('follows a node_modules symlink to a shared install', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dobius-installed-deps-'))
    try {
      const shared = path.join(root, 'shared-install', 'node_modules')
      const project = path.join(root, 'worktree')
      await mkdir(path.join(shared, 'a'), { recursive: true })
      await mkdir(project, { recursive: true })
      await writeFile(path.join(shared, 'a', 'package.json'), JSON.stringify({ version: '1.0.0' }))
      await symlink(shared, path.join(project, 'node_modules'))
      await writeFile(
        path.join(project, 'package.json'),
        JSON.stringify({ dependencies: { a: '^1.0.0' } })
      )
      await writeFile(
        path.join(project, 'pnpm-lock.yaml'),
        stringify(lockOf({ a: { specifier: '^1.0.0', version: '1.0.0' } }))
      )
      expect(main(['--project', project])).toBe(0)

      await writeFile(
        path.join(project, 'pnpm-lock.yaml'),
        stringify(lockOf({ a: { specifier: '^1.0.0', version: '1.1.0' } }))
      )
      expect(main(['--project', project])).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('runs only before packaging, never in dev, test, typecheck or the plain build', () => {
    const { scripts } = JSON.parse(readFileSync(path.join(projectDir, 'package.json'), 'utf8'))
    const check = 'node config/scripts/check-installed-deps.mjs && '
    for (const name of ['build:unpack', 'build:mac', 'build:mac:release', 'build:win', 'build:linux']) {
      expect(scripts[name], name).toContain(check)
      expect(scripts[name].indexOf(check), name).toBeLessThan(scripts[name].indexOf('pnpm run build'))
    }
    for (const name of ['dev', 'start', 'test', 'typecheck', 'build', 'build:desktop', 'build:release']) {
      expect(scripts[name] ?? '', name).not.toContain('check-installed-deps')
    }
  })
})
