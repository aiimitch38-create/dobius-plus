import { describe, expect, it } from 'vitest'
import { ancestorDirs, buildPostcheckSandboxProfile } from './agent-run-postcheck-profile'

const base = {
  cwd: '/Users/me/Projects (Code)/app',
  tempDir: '/private/tmp/t',
  secretPaths: ['/Users/me/.ssh', '/Volumes/vault/aws'],
  envLinkTargets: ['/Users/me/Projects (Code)/app/conf/plain.txt']
}

describe('buildPostcheckSandboxProfile', () => {
  const profile = buildPostcheckSandboxProfile(base)
  const lines = profile.split('\n')
  const lastAllow = lines.findLastIndex((line) => line.startsWith('(allow'))

  it('denies by default and grants no network, shared memory or semaphores', () => {
    expect(lines[1]).toBe('(deny default)')
    expect(lines.at(-1)).toBe('(deny network*)')
    expect(profile).not.toMatch(/allow network|allow default|ipc-posix|allow mach-lookup\)/)
  })

  it('allows writes only in the run folder and the temp folder', () => {
    expect(profile).toContain(
      '(allow file-write* (subpath "/Users/me/Projects (Code)/app") (subpath "/private/tmp/t"))'
    )
    expect(lines.filter((line) => line.startsWith('(allow file-write*'))).toHaveLength(1)
  })

  it('puts every write and move deny after the last allow', () => {
    const denies = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.startsWith('(deny file-write'))
    expect(denies).toHaveLength(4)
    for (const { index } of denies) {
      expect(index).toBeGreaterThan(lastAllow)
    }
  })

  it('denies reading and changing every secret spelling and .env link target', () => {
    for (const secret of [...base.secretPaths, ...base.envLinkTargets]) {
      expect(profile).toMatch(new RegExp(`\\(deny file-read\\* .*\\(subpath "${secret.replaceAll(/[()]/g, '\\$&')}"\\)`))
      expect(profile).toMatch(new RegExp(`\\(deny file-write\\* .*\\(subpath "${secret.replaceAll(/[()]/g, '\\$&')}"\\)`))
    }
  })

  it('blocks renaming the run folder and every folder above a secret', () => {
    const moveBlock = lines.find((line) => line.startsWith('(deny file-write-unlink file-write-create'))
    for (const dir of ['/Users/me/Projects (Code)/app', '/Users/me', '/Users', '/Volumes/vault', '/Users/me/Projects (Code)/app/conf']) {
      expect(moveBlock).toContain(`(literal "${dir}")`)
    }
  })

  it('protects the files that run unsandboxed later', () => {
    const protectedLine = lines.find((line) => line.startsWith('(deny file-write* (regex #"/\\.claude'))
    for (const name of ['.claude', '.mcp', '.git/hooks', '.git/config', '.husky']) {
      expect(protectedLine).toContain(name.replaceAll('.', '\\.'))
    }
  })

  it('escapes quotes in paths', () => {
    expect(buildPostcheckSandboxProfile({ ...base, cwd: '/Users/me/a"b' })).toContain(
      String.raw`(subpath "/Users/me/a\"b")`
    )
  })
})

describe('ancestorDirs', () => {
  it('lists every folder above a path, stopping before the root', () => {
    expect(ancestorDirs('/Users/me/.ssh')).toEqual(['/Users/me', '/Users'])
  })
})
