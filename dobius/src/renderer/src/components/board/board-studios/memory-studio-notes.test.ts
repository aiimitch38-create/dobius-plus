import { describe, expect, it } from 'vitest'
import type { KnowledgeLeaf, KnowledgeTree } from '../../../../../shared/knowledge'
import {
  MEMORY_PUSH_MAX_CHARS,
  buildMemoryPushPrompt,
  claudeProjectDirName,
  splitKnowledgeNotes
} from './memory-studio-notes'

function leaf(id: string, filePath: string): KnowledgeLeaf {
  return { id, title: id, summary: '', filePath, icon: '', links: [], addedAt: 0 }
}

function tree(branches: [string, KnowledgeLeaf[]][]): KnowledgeTree {
  return {
    hubLabel: 'Knowledge',
    hubSub: '',
    branches: branches.map(([id, leaves]) => ({
      id,
      label: id,
      sub: '',
      leaves,
      groups: [],
      totalCount: leaves.length
    }))
  }
}

describe('claudeProjectDirName', () => {
  it('matches the Claude CLI folder encoding', () => {
    expect(claudeProjectDirName('/Users/me/Projects (Code)/Dobius/dobius-plus')).toBe(
      '-Users-me-Projects--Code--Dobius-dobius-plus'
    )
  })
})

describe('splitKnowledgeNotes', () => {
  const repo = '/Users/me/app'
  const knowledge = tree([
    [
      'memory',
      [
        leaf('mine', '/Users/me/.claude/projects/-Users-me-app/memory/a.md'),
        leaf('other', '/Users/me/.claude/projects/-Users-me-app-two/memory/b.md')
      ]
    ],
    [
      'projects',
      [leaf('claude-md', '/Users/me/app/CLAUDE.md'), leaf('sib', '/Users/me/app-two/CLAUDE.md')]
    ],
    ['rules', [leaf('house', '/Users/me/.claude/CLAUDE.md')]],
    ['skills', [leaf('skill', '/Users/me/app/skills/x.md')]]
  ])

  it('puts repo files and the repo memory folder under repo, the rest under global', () => {
    const split = splitKnowledgeNotes(knowledge, [repo])
    expect(split.repo.map((n) => n.id)).toEqual(['mine', 'claude-md'])
    expect(split.global.map((n) => n.id)).toEqual(['other', 'sib', 'house'])
  })

  it('treats every note as global without a project root', () => {
    const split = splitKnowledgeNotes(knowledge, [])
    expect(split.repo).toEqual([])
    expect(split.global).toHaveLength(5)
  })

  it('handles Windows separators', () => {
    const win = tree([['projects', [leaf('w', 'C:\\code\\app\\CLAUDE.md')]]])
    expect(splitKnowledgeNotes(win, ['C:\\code\\app\\']).repo).toHaveLength(1)
  })
})

describe('buildMemoryPushPrompt', () => {
  it('names the note and its path', () => {
    const prompt = buildMemoryPushPrompt({ title: 'T', filePath: '/n.md', content: ' body ' })
    expect(prompt).toBe('Use this memory note as context: "T" (/n.md)\n\nbody')
  })

  it('truncates long notes and points to the file', () => {
    const prompt = buildMemoryPushPrompt({
      title: 'T',
      filePath: '/n.md',
      content: 'x'.repeat(MEMORY_PUSH_MAX_CHARS + 50)
    })
    expect(prompt).toContain('[Truncated. Read the full note at /n.md]')
    expect(prompt.length).toBeLessThan(MEMORY_PUSH_MAX_CHARS + 200)
  })
})
