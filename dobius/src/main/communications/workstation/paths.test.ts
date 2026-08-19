import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/dobius-workstation-userdata' } }))

import {
  resolveContainedPath,
  resolveProjectLocalPath,
  resolveRemoteCachePath,
  resolveReposDir,
  sanitizeProjectDtag,
  WorkstationPathError
} from './paths'

describe('sanitizeProjectDtag', () => {
  it('accepts an ordinary identifier', () => {
    expect(sanitizeProjectDtag('my-project_1.2')).toBe('my-project_1.2')
  })

  it('rejects a traversal segment', () => {
    expect(() => sanitizeProjectDtag('../../etc')).toThrow(WorkstationPathError)
  })

  it('rejects a bare ".."', () => {
    expect(() => sanitizeProjectDtag('..')).toThrow(WorkstationPathError)
  })

  it('rejects an embedded path separator', () => {
    expect(() => sanitizeProjectDtag('foo/bar')).toThrow(WorkstationPathError)
    expect(() => sanitizeProjectDtag('foo\\bar')).toThrow(WorkstationPathError)
  })

  it('rejects an empty string', () => {
    expect(() => sanitizeProjectDtag('   ')).toThrow(WorkstationPathError)
  })
})

describe('resolveReposDir', () => {
  it('rejects a relative reposDir override', () => {
    expect(() => resolveReposDir('relative/path')).toThrow(WorkstationPathError)
  })

  it('accepts an absolute reposDir override', () => {
    expect(resolveReposDir('/tmp/some-repos')).toBe('/tmp/some-repos')
  })
})

describe('resolveContainedPath (path traversal)', () => {
  it('rejects a childName that escapes the root via ..', () => {
    expect(() => resolveContainedPath('/tmp/root', '../../etc/passwd')).toThrow(WorkstationPathError)
  })

  it('never lets an absolute-looking childName escape root — node path.join treats it as a relative segment', () => {
    // Why: path.join (unlike path.resolve) does not reset on a segment that
    // starts with "/" — it's concatenated and normalized like any other
    // segment. Documenting that here as the actual (safe) behavior, since it
    // is exactly why resolveContainedPath is implemented on top of join, not
    // resolve, for the childName half of the join.
    expect(resolveContainedPath('/tmp/root', '/etc/passwd')).toBe('/tmp/root/etc/passwd')
  })

  it('rejects a childName equal to the root itself', () => {
    expect(() => resolveContainedPath('/tmp/root', '.')).toThrow(WorkstationPathError)
  })

  it('accepts an ordinary child name', () => {
    expect(resolveContainedPath('/tmp/root', 'child')).toBe('/tmp/root/child')
  })
})

describe('resolveProjectLocalPath', () => {
  it('rejects a projectDtag crafted to escape reposDir', () => {
    expect(() => resolveProjectLocalPath('/tmp/repos', '../../../etc')).toThrow(WorkstationPathError)
  })

  it('resolves an ordinary projectDtag under reposDir', () => {
    expect(resolveProjectLocalPath('/tmp/repos', 'my-project')).toBe('/tmp/repos/my-project')
  })
})

describe('resolveRemoteCachePath', () => {
  it('produces a stable, contained path for a given clone URL', () => {
    const a = resolveRemoteCachePath('https://example.com/a.git')
    const b = resolveRemoteCachePath('https://example.com/a.git')
    const c = resolveRemoteCachePath('https://example.com/b.git')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
