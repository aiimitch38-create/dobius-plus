import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildGitGrepArgs, buildRgArgs } from './text-search'

const SECRET_GLOBS = ['**/*token*', '**/*password*', '**/*credential*']

describe('caseInsensitiveExcludeGlobs', () => {
  it('rg gets each one as its own --iglob, after and apart from excludePattern', () => {
    const args = buildRgArgs('q', '/root', {
      excludePattern: 'dist/**,a\\',
      caseInsensitiveExcludeGlobs: SECRET_GLOBS
    })
    for (const glob of SECRET_GLOBS) {
      const at = args.indexOf(`!${glob}`)
      expect(at).toBeGreaterThan(0)
      expect(args[at - 1]).toBe('--iglob')
    }
  })

  it('git grep gets :(exclude,icase,glob) pathspecs', () => {
    const args = buildGitGrepArgs('q', { caseInsensitiveExcludeGlobs: ['**/*token*', 'id_rsa*'] })
    expect(args).toContain(':(exclude,icase,glob)**/*token*')
    expect(args).toContain(':(exclude,icase,glob)**/id_rsa*')
  })

  describe('real git grep', () => {
    let dir: string
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'icase-excludes-'))
      execFileSync('git', ['init', '-q'], { cwd: dir })
      writeFileSync(join(dir, 'TOKEN.txt'), 'NEEDLE')
      writeFileSync(join(dir, 'PASSWORD'), 'NEEDLE')
      writeFileSync(join(dir, 'CREDENTIALS'), 'NEEDLE')
      writeFileSync(join(dir, 'app.ts'), 'NEEDLE')
    })
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    it('finds the normal file and none of the upper-case secret names', () => {
      const out = execFileSync(
        'git',
        buildGitGrepArgs('NEEDLE', { caseInsensitiveExcludeGlobs: SECRET_GLOBS }),
        { cwd: dir, encoding: 'utf8' }
      )
      const files = out
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\0')[0])
      expect(files).toEqual(['app.ts'])
    })
  })
})
