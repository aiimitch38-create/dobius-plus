/**
 * Why: relay (SSH) stage/unstage must treat file names as literal paths, like
 * the local git service. A file literally named `*.txt` must not act as a glob.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { GitHandler } from './git-handler'
import { RelayContext } from './context'
import {
  createMockDispatcher,
  gitCommit,
  gitInit,
  type MockDispatcher,
  type RelayDispatcher
} from './git-handler-test-setup'

const GLOB_NAME = '*.txt'

describe('GitHandler staging uses literal pathspecs', () => {
  let dispatcher: MockDispatcher
  let tmpDir: string

  function staged(): string[] {
    return execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: tmpDir,
      encoding: 'utf-8'
    })
      .split('\n')
      .filter((line) => line.length > 0)
      .sort()
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'relay-git-literal-'))
    dispatcher = createMockDispatcher()
    // eslint-disable-next-line no-new
    new GitHandler(dispatcher as unknown as RelayDispatcher, new RelayContext())
    gitInit(tmpDir)
    for (const name of [GLOB_NAME, 'a.txt', 'b.txt']) {
      writeFileSync(path.join(tmpDir, name), 'one')
    }
    gitCommit(tmpDir, 'initial')
    for (const name of [GLOB_NAME, 'a.txt', 'b.txt']) {
      writeFileSync(path.join(tmpDir, name), 'two')
    }
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('git.stage stages only the file with that exact name', async () => {
    await dispatcher.callRequest('git.stage', { worktreePath: tmpDir, filePath: GLOB_NAME })
    expect(staged()).toEqual([GLOB_NAME])
  })

  it('git.bulkStage stages only the exact names', async () => {
    await dispatcher.callRequest('git.bulkStage', { worktreePath: tmpDir, filePaths: [GLOB_NAME] })
    expect(staged()).toEqual([GLOB_NAME])
  })

  it('git.unstage and git.bulkUnstage unstage only the exact names', async () => {
    execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' })
    await dispatcher.callRequest('git.unstage', { worktreePath: tmpDir, filePath: GLOB_NAME })
    expect(staged()).toEqual(['a.txt', 'b.txt'])
    execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' })
    await dispatcher.callRequest('git.bulkUnstage', {
      worktreePath: tmpDir,
      filePaths: [GLOB_NAME]
    })
    expect(staged()).toEqual(['a.txt', 'b.txt'])
  })
})
