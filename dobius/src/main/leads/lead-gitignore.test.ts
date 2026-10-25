import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findGitIgnoredLeadFiles, gitIgnoreWarning } from './lead-gitignore'

let repo: string

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'lead-gitignore-'))
})

afterEach(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('findGitIgnoredLeadFiles', () => {
  it('names the lead files a .dobius rule would ignore', async () => {
    execFileSync('git', ['init', '-q'], { cwd: repo })
    writeFileSync(join(repo, '.gitignore'), '.dobius\n')
    expect((await findGitIgnoredLeadFiles(repo)).sort()).toEqual([
      '.dobius/ORCHESTRATOR.md',
      '.dobius/lead.json'
    ])
  })

  it('is empty when the negations are in place, and outside a git repo', async () => {
    expect(await findGitIgnoredLeadFiles(repo)).toEqual([])
    execFileSync('git', ['init', '-q'], { cwd: repo })
    writeFileSync(
      join(repo, '.gitignore'),
      '.dobius/*\n!.dobius/ORCHESTRATOR.md\n!.dobius/lead.json\n'
    )
    expect(await findGitIgnoredLeadFiles(repo)).toEqual([])
  })

  it('the warning tells the user the exact lines to add', () => {
    const text = gitIgnoreWarning('/r', ['.dobius/lead.json'])
    expect(text).toContain('.dobius/*')
    expect(text).toContain('!.dobius/ORCHESTRATOR.md')
    expect(text).toContain('!.dobius/lead.json')
  })
})
