import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertExecutionDirectorySeparation } from './execution-directory-separation'

const directories: string[] = []
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
)
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'worker-directory-separation-')))
  directories.push(base)
  const paths = ['repo', 'worktree-1', 'worktree-2', 'home-1', 'home-2'].map((name) =>
    join(base, name)
  )
  paths.forEach((path) => mkdirSync(path))
  return {
    base,
    registry: {
      roots: [{ canonicalPath: paths[0]! }],
      worktrees: [{ canonicalPath: paths[1]! }, { canonicalPath: paths[2]! }],
      profiles: [{ home: paths[3]! }, { home: paths[4]! }]
    }
  }
}
describe('execution source/credential separation', () => {
  it('allows distinct sibling homes and worktrees', () => {
    const f = fixture()
    expect(() => assertExecutionDirectorySeparation(f.registry)).not.toThrow()
  })
  it('rejects a checkout used as both origin root and worker worktree', () => {
    const f = fixture()
    f.registry.worktrees[0]!.canonicalPath = f.registry.roots[0]!.canonicalPath
    expect(() => assertExecutionDirectorySeparation(f.registry)).toThrow('distinct')
  })
  it('rejects credential homes aliasing or nested under a source checkout', () => {
    const f = fixture()
    f.registry.profiles[0]!.home = f.registry.roots[0]!.canonicalPath
    expect(() => assertExecutionDirectorySeparation(f.registry)).toThrow('overlap')
    const nested = join(f.registry.worktrees[0]!.canonicalPath, 'private-home')
    mkdirSync(nested)
    f.registry.profiles[0]!.home = nested
    expect(() => assertExecutionDirectorySeparation(f.registry)).toThrow('overlap')
  })
  it('rejects a credential home containing source checkouts', () => {
    const f = fixture()
    f.registry.profiles[0]!.home = f.base
    expect(() => assertExecutionDirectorySeparation(f.registry)).toThrow('overlap')
  })
})
