import { describe, expect, it } from 'vitest'
import { checkupSkill, parseSkillFile } from './skill-checkup'
import {
  SKILL_STARTERS,
  buildSkillMarkdown,
  duplicateSkillName,
  renameSkillMarkdown,
  starterSkillMarkdown,
  toSkillName,
  yamlScalar
} from './skill-starters'

describe('SKILL_STARTERS', () => {
  it('has the 12 starters with unique names', () => {
    expect(SKILL_STARTERS.map((s) => s.name)).toEqual([
      'commit',
      'pr-description',
      'changelog',
      'test-first',
      'bug-hunt',
      'refactor-plan',
      'api-docs',
      'standup',
      'explain',
      'perf-pass',
      'deps-audit',
      'readme-refresh'
    ])
  })

  it.each(SKILL_STARTERS.map((s) => [s.name, s] as const))(
    '%s generates a SKILL.md that passes checkup cleanly',
    (_name, item) => {
      const md = starterSkillMarkdown(item)
      expect(checkupSkill({ content: md, folderName: item.name })).toEqual([])
      const parsed = parseSkillFile(md)
      expect(parsed.fields?.description).toBe(item.description)
    }
  )
})

describe('SKILL.md helpers', () => {
  it('quotes YAML scalars only when needed', () => {
    expect(yamlScalar('Plain words, fine.')).toBe('Plain words, fine.')
    expect(yamlScalar('Use: when "x"')).toBe('"Use: when \\"x\\""')
    expect(yamlScalar('#tag')).toBe('"#tag"')
  })

  it('round-trips a quoted description through the parser', () => {
    const md = buildSkillMarkdown({ name: 'a', description: 'Say "hi": always', body: 'x' })
    expect(parseSkillFile(md).fields?.description).toBe('Say "hi": always')
  })

  it('normalizes free text into a valid name', () => {
    expect(toSkillName('  My Cool Skill!! ')).toBe('my-cool-skill')
    expect(toSkillName('Ça va')).toBe('ca-va')
    expect(toSkillName('x'.repeat(80))).toHaveLength(64)
  })

  it('picks a free copy name', () => {
    expect(duplicateSkillName('commit', [])).toBe('commit-copy')
    expect(duplicateSkillName('commit', ['commit-copy', 'commit-copy-2'])).toBe('commit-copy-3')
  })

  it('renames the frontmatter name or adds frontmatter', () => {
    expect(renameSkillMarkdown('---\nname: old\ndescription: d\n---\nbody', 'new')).toBe(
      '---\nname: new\ndescription: d\n---\nbody'
    )
    expect(renameSkillMarkdown('---\ndescription: d\n---\nbody', 'new')).toBe(
      '---\nname: new\ndescription: d\n---\nbody'
    )
    expect(renameSkillMarkdown('body', 'new')).toBe('---\nname: new\n---\n\nbody')
  })
})
