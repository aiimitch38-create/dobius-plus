import { describe, expect, it } from 'vitest'
import type { SkillDiscoverySource } from '../../../../shared/skills'
import { skillFolderName, skillScopes, skillTargetPath } from './skill-files'

const src = (
  id: string,
  sourceKind: SkillDiscoverySource['sourceKind'],
  skippedReason?: SkillDiscoverySource['skippedReason']
): SkillDiscoverySource => ({
  id,
  label: id,
  path: `/x/${id}`,
  sourceKind,
  providers: ['claude'],
  exists: !skippedReason,
  ...(skippedReason ? { skippedReason } : {})
})

describe('skillScopes', () => {
  it('offers home and repo folders, Claude home first, never plugin or remote roots', () => {
    const scopes = skillScopes([
      src('home-codex', 'home'),
      src('codex-plugin-cache', 'plugin'),
      src('repo-claude-1', 'repo'),
      src('repo-claude-2', 'repo', 'remote-repo'),
      src('home-claude', 'home', 'missing')
    ])
    expect(scopes.map((s) => s.id)).toEqual(['home-claude', 'home-codex', 'repo-claude-1'])
  })
})

describe('skillTargetPath', () => {
  it('builds <scope>/<name>/SKILL.md for valid names only', () => {
    expect(skillTargetPath('/h/.claude/skills', 'commit')).toBe('/h/.claude/skills/commit/SKILL.md')
    expect(() => skillTargetPath('/h', '../evil')).toThrow()
    expect(() => skillTargetPath('/h', 'Bad Name')).toThrow()
    expect(() => skillTargetPath('/h', '')).toThrow()
  })

  it('reads the folder name back from a SKILL.md path', () => {
    expect(skillFolderName('/h/.claude/skills/commit/SKILL.md')).toBe('commit')
    expect(skillFolderName('C:\\u\\skills\\x\\SKILL.md')).toBe('x')
  })
})
