import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readKnowledgeFileWithin } from './knowledge-access'

let dir: string
let root: string
let outside: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'knowledge-access-'))
  root = join(dir, 'root')
  outside = join(dir, 'outside')
  mkdirSync(join(root, 'skills', 'design-tokens'), { recursive: true })
  mkdirSync(join(root, 'secrets'), { recursive: true })
  mkdirSync(outside)
  writeFileSync(join(root, 'notes.md'), 'hello')
  writeFileSync(join(root, 'skills', 'design-tokens', 'SKILL.md'), 'tokens skill')
  writeFileSync(join(root, 'secrets', 'aws.md'), 'nope')
  writeFileSync(join(root, 'api-keys.md'), 'nope')
  writeFileSync(join(root, '.env.md'), 'nope')
  writeFileSync(join(root, 'notes.txt'), 'nope')
  writeFileSync(join(outside, 'private.md'), 'outside')
  symlinkSync(join(outside, 'private.md'), join(root, 'link.md'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readKnowledgeFileWithin', () => {
  it('reads a Markdown file inside a root', () => {
    expect(readKnowledgeFileWithin(join(root, 'notes.md'), [root]).content).toBe('hello')
  })

  it('refuses a symlink that leads outside the root, and paths that climb out', () => {
    expect(() => readKnowledgeFileWithin(join(root, 'link.md'), [root])).toThrow(/outside/)
    expect(() => readKnowledgeFileWithin(join(root, '..', 'outside', 'private.md'), [root])).toThrow(
      /outside/
    )
  })

  it('refuses secret-looking names, non-Markdown files and relative paths', () => {
    for (const name of [
      join('secrets', 'aws.md'),
      'api-keys.md',
      '.env.md',
      join('skills', 'design-tokens', 'SKILL.md')
    ]) {
      expect(() => readKnowledgeFileWithin(join(root, name), [root])).toThrow(/secrets/)
    }
    expect(() => readKnowledgeFileWithin(join(root, 'notes.txt'), [root])).toThrow(/Markdown/)
    expect(() => readKnowledgeFileWithin('notes.md', [root])).toThrow(/full path/)
    expect(() => readKnowledgeFileWithin(join(root, 'missing.md'), [root])).toThrow(/Could not/)
  })
})
