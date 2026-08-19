import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertNotFlagLike, runGit } from './git-exec'

describe('assertNotFlagLike', () => {
  it('passes through an ordinary value', () => {
    expect(assertNotFlagLike('main', 'branch')).toBe('main')
  })

  it('rejects a value that looks like a flag (argv smuggling)', () => {
    expect(() => assertNotFlagLike('--upload-pack=touch pwned', 'branch')).toThrow(/must not start with/)
  })

  it('rejects a bare "-"', () => {
    expect(() => assertNotFlagLike('-', 'branch')).toThrow()
  })
})

describe('runGit', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'dobius-workstation-git-exec-'))
    execFileSync('git', ['init', '--quiet', tmpDir])
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('runs a real git command via execFile (no shell)', async () => {
    const { stdout } = await runGit(['rev-parse', '--is-inside-work-tree'], tmpDir)
    expect(stdout.trim()).toBe('true')
  })

  it('rejects with the real git error for an invalid command', async () => {
    await expect(runGit(['not-a-real-git-subcommand'], tmpDir)).rejects.toThrow()
  })
})
