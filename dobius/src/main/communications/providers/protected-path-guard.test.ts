import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProtectedPathError, assertPathOutsideProtectedRoots } from './protected-path-guard'

function workspace(): { base: string; secrets: string } {
  const base = mkdtempSync(join(tmpdir(), 'guard-'))
  const secrets = join(base, 'secrets')
  mkdirSync(secrets, { recursive: true })
  writeFileSync(join(secrets, 'key.txt'), 'shh\n')
  mkdirSync(join(base, 'work'), { recursive: true })
  return { base, secrets }
}

describe('assertPathOutsideProtectedRoots', () => {
  it('allows a path outside every protected root', () => {
    const { base, secrets } = workspace()
    expect(() =>
      assertPathOutsideProtectedRoots([secrets], 'work/notes.txt', base)
    ).not.toThrow()
  })

  it('refuses a path inside a protected root', () => {
    const { base, secrets } = workspace()
    expect(() => assertPathOutsideProtectedRoots([secrets], 'secrets/key.txt', base)).toThrow(
      ProtectedPathError
    )
  })

  it('refuses the protected root itself', () => {
    const { base, secrets } = workspace()
    expect(() => assertPathOutsideProtectedRoots([secrets], secrets, base)).toThrow(
      ProtectedPathError
    )
  })

  it('refuses a traversal that climbs back into a protected root', () => {
    const { base, secrets } = workspace()
    expect(() =>
      assertPathOutsideProtectedRoots([secrets], 'work/../secrets/key.txt', base)
    ).toThrow(ProtectedPathError)
  })

  it('refuses a symlink that points into a protected root', () => {
    const { base, secrets } = workspace()
    const link = join(base, 'work', 'sneaky')
    symlinkSync(secrets, link)
    expect(() =>
      assertPathOutsideProtectedRoots([secrets], 'work/sneaky/key.txt', base)
    ).toThrow(ProtectedPathError)
  })

  it('checks the real parent when the leaf does not exist yet', () => {
    const { base, secrets } = workspace()
    const link = join(base, 'work', 'sneaky2')
    symlinkSync(secrets, link)
    expect(() =>
      assertPathOutsideProtectedRoots([secrets], 'work/sneaky2/not-created-yet.txt', base)
    ).toThrow(ProtectedPathError)
  })

  it('is a no-op when no roots are protected', () => {
    const { base, secrets } = workspace()
    expect(() => assertPathOutsideProtectedRoots([], secrets, base)).not.toThrow()
  })

  it('does not refuse a sibling whose name merely prefixes a root', () => {
    const { base, secrets } = workspace()
    mkdirSync(join(base, 'secrets-public'), { recursive: true })
    expect(() =>
      assertPathOutsideProtectedRoots([secrets], 'secrets-public/readme.md', base)
    ).not.toThrow()
  })
})
