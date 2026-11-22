import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  findEnvLinkTargets,
  postcheckSecretPaths,
  resolveThroughExisting
} from './agent-run-postcheck-paths'

let root = ''

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dobius-postcheck-paths-')))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveThroughExisting', () => {
  it('resolves the existing part of a path that does not exist yet', () => {
    mkdirSync(path.join(root, 'real'))
    symlinkSync(path.join(root, 'real'), path.join(root, 'link'))
    expect(resolveThroughExisting(path.join(root, 'link', 'missing', 'file'))).toBe(
      path.join(root, 'real', 'missing', 'file')
    )
  })
})

describe('postcheckSecretPaths', () => {
  it('also denies other Dobius userData roots, skipping glob roots', () => {
    const home = path.join(root, 'home')
    mkdirSync(home)
    const dev = path.join(root, 'Dobius+-dev')
    const secrets = postcheckSecretPaths({
      homeDir: home,
      userDataDir: path.join(root, 'dobius-plus'),
      otherUserDataDirs: [dev, path.join(root, '*')]
    })
    expect(secrets).toContain(dev)
    expect(secrets.some((entry) => entry.includes('*'))).toBe(false)
  })

  it('lists a symlinked sign-in folder under both of its names', () => {
    const home = path.join(root, 'home')
    const vault = path.join(root, 'vault')
    mkdirSync(home)
    mkdirSync(vault)
    symlinkSync(vault, path.join(home, '.aws'))
    const secrets = postcheckSecretPaths({ homeDir: home, userDataDir: path.join(home, 'data') })
    expect(secrets).toContain(path.join(home, '.aws'))
    expect(secrets).toContain(vault)
    expect(secrets).toContain(path.join(home, '.ssh'))
    expect(secrets).toContain(path.join(home, 'data'))
  })

  it('lists both names of a home folder that is itself a symlink', () => {
    const realHome = path.join(root, 'real-home')
    mkdirSync(realHome)
    symlinkSync(realHome, path.join(root, 'home'))
    const secrets = postcheckSecretPaths({ homeDir: path.join(root, 'home'), userDataDir: '/x' })
    expect(secrets).toContain(path.join(root, 'home', '.ssh'))
    expect(secrets).toContain(path.join(realHome, '.ssh'))
  })
})

describe('findEnvLinkTargets', () => {
  it('finds where .env symlinks point, nested ones included, and skips real .env files', () => {
    mkdirSync(path.join(root, 'conf'))
    mkdirSync(path.join(root, 'pkg', 'api'), { recursive: true })
    writeFileSync(path.join(root, 'conf', 'a.txt'), 'x')
    writeFileSync(path.join(root, 'conf', 'b.txt'), 'x')
    writeFileSync(path.join(root, '.env'), 'x')
    symlinkSync(path.join(root, 'conf', 'a.txt'), path.join(root, '.env.local'))
    symlinkSync(path.join(root, 'conf', 'b.txt'), path.join(root, 'pkg', 'api', '.env'))
    expect(findEnvLinkTargets(root).toSorted()).toEqual([
      path.join(root, 'conf', 'a.txt'),
      path.join(root, 'conf', 'b.txt')
    ])
  })

  it('does not walk into node_modules or .git', () => {
    mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true })
    symlinkSync('/etc/hosts', path.join(root, 'node_modules', 'x', '.env'))
    expect(findEnvLinkTargets(root)).toEqual([])
  })
})
