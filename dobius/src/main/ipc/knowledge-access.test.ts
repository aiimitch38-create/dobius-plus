import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { filterKnowledgeTree, readKnowledgeFileWithin } from './knowledge-access'
import { safeReadFile } from './knowledge-leaf-sources'

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
    expect(() => readKnowledgeFileWithin(join(root, 'link.md'), [root])).toThrow(/a link/)
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

  it('refuses symlinks even when they point inside the root, including folder links', () => {
    mkdirSync(join(root, 'real'))
    writeFileSync(join(root, 'real', 'a.md'), 'inside')
    symlinkSync(join(root, 'real'), join(root, 'alias'))
    symlinkSync(join(root, 'notes.md'), join(root, 'same.md'))
    expect(readKnowledgeFileWithin(join(root, 'real', 'a.md'), [root]).content).toBe('inside')
    expect(() => readKnowledgeFileWithin(join(root, 'alias', 'a.md'), [root])).toThrow(/a link/)
    expect(() => readKnowledgeFileWithin(join(root, 'same.md'), [root])).toThrow(/a link/)
  })

  it('accepts a root that is itself a symlink, as configured', () => {
    const linkedRoot = join(dir, 'linked-root')
    symlinkSync(root, linkedRoot)
    expect(readKnowledgeFileWithin(join(linkedRoot, 'notes.md'), [linkedRoot]).content).toBe('hello')
  })

  it('reads only the file it checked (the opened file must match by dev/ino)', () => {
    const path = join(root, 'notes.md')
    expect(safeReadFile(path, undefined, () => false)).toBeNull()
    expect(safeReadFile(path, undefined, () => true)).toBe('hello')
  })

  it('never blocks on a FIFO named like a knowledge file', () => {
    const fifo = join(root, 'pipe.md')
    execFileSync('mkfifo', [fifo])
    expect(safeReadFile(fifo)).toBeNull()
    expect(() => readKnowledgeFileWithin(fifo, [root])).toThrow(/Could not read/)
  })
})

describe('filterKnowledgeTree', () => {
  it('drops leaves that knowledge read would refuse, with their links and group ids', () => {
    const leaf = (id: string, filePath: string) => ({
      id,
      title: id,
      summary: `summary of ${id}`,
      filePath,
      icon: '',
      links: ['ok', 'secret', 'link'],
      addedAt: 0
    })
    const tree = filterKnowledgeTree(
      {
        hubLabel: 'Knowledge',
        hubSub: '',
        branches: [
          {
            id: 'docs',
            label: 'Docs',
            sub: '',
            totalCount: 3,
            leaves: [
              leaf('ok', join(root, 'notes.md')),
              leaf('secret', join(root, 'api-keys.md')),
              leaf('link', join(root, 'link.md'))
            ],
            groups: [{ id: 'g', label: 'g', leafIds: ['ok', 'secret', 'link'] }]
          }
        ]
      },
      [root]
    )
    const [branch] = tree.branches
    expect(branch.leaves.map((entry) => entry.id)).toEqual(['ok'])
    expect(branch.leaves[0].links).toEqual(['ok'])
    expect(branch.groups[0].leafIds).toEqual(['ok'])
    expect(JSON.stringify(tree)).not.toContain('summary of secret')
    // The summary is taken again from the guarded read, not the indexer's.
    expect(branch.leaves[0].summary).toBe('hello')
  })
})
