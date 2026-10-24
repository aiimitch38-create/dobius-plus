import { describe, expect, it } from 'vitest'
import { checkupSkill, checkupSkills, countIssues, parseSkillFile } from './skill-checkup'

const codes = (content: string, folderName?: string): string[] =>
  checkupSkill({ content, folderName }).map((i) => i.code)

const good = `---
name: release-notes
description: Write release notes from merged pull requests. Use before tagging a release.
---

# Release notes

1. Collect merged PRs.
`

describe('parseSkillFile', () => {
  it('reads plain, quoted and block-scalar fields', () => {
    const parsed = parseSkillFile(
      '---\nname: "a-b"\ndescription: >\n  first line\n  second line\nallowed-tools: Read, Grep\nmetadata:\n  owner: me\n---\nBody\n'
    )
    expect(parsed.fields).toMatchObject({
      name: 'a-b',
      description: 'first line second line',
      'allowed-tools': 'Read, Grep',
      metadata: 'owner: me'
    })
    expect(parsed.keys).toEqual(['name', 'description', 'allowed-tools', 'metadata'])
    expect(parsed.body.trim()).toBe('Body')
  })

  it('handles CRLF and a BOM', () => {
    expect(parseSkillFile('﻿---\r\nname: x\r\n---\r\nhi').fields?.name).toBe('x')
  })
})

describe('checkupSkill', () => {
  it('passes a well-formed skill whose folder matches', () => {
    expect(checkupSkill({ content: good, folderName: 'release-notes' })).toEqual([])
  })

  it('flags missing or unclosed frontmatter', () => {
    expect(codes('# Just text')).toEqual(['no-frontmatter'])
    expect(codes('---\nname: x\n')).toEqual(['unclosed-frontmatter'])
  })

  it('requires name and description', () => {
    expect(codes('---\nlicense: MIT\n---\nbody')).toEqual(['missing-name', 'missing-description'])
  })

  it('checks the name format, length, reserved words and folder', () => {
    expect(codes(good.replace('release-notes', 'Release_Notes'))).toContain('name-format')
    expect(codes(good.replace('release-notes', 'a--b'))).toContain('name-format')
    expect(codes(good.replace('release-notes', 'x'.repeat(65)))).toContain('name-too-long')
    expect(codes(good.replace('release-notes', 'claude-helper'))).toContain('name-reserved')
    expect(codes(good, 'notes')).toContain('name-folder-mismatch')
  })

  it('checks the description length and markup', () => {
    expect(codes(good.replace(/description: .*/, 'description: Too short'))).toContain(
      'description-too-short'
    )
    expect(codes(good.replace(/description: .*/, `description: ${'x'.repeat(1025)}`))).toContain(
      'description-too-long'
    )
    expect(
      codes(
        good.replace(/description: .*/, 'description: Use <b>always</b> for every release task.')
      )
    ).toContain('description-xml')
  })

  it('marks Claude-Code-only and unknown fields as info', () => {
    const issues = checkupSkill({
      content: good.replace('---\n\n', 'allowed-tools: Read\nfoo: bar\n---\n\n'),
      folderName: 'release-notes'
    })
    expect(issues.map((i) => [i.code, i.severity, i.field])).toEqual([
      ['claude-code-only-field', 'info', 'allowed-tools'],
      ['unknown-field', 'info', 'foo']
    ])
  })

  it('warns about an empty body and hints at a long one', () => {
    expect(codes('---\nname: a\ndescription: Does a thing when asked to do it.\n---\n')).toEqual([
      'empty-body'
    ])
    const long = `${good}${'line\n'.repeat(600)}`
    expect(codes(long)).toContain('long-body')
  })
})

describe('checkupSkills', () => {
  it('flags duplicate names across skills only on the duplicates', () => {
    const results = checkupSkills([
      { id: '1', content: good, folderName: 'release-notes' },
      { id: '2', content: good, folderName: 'release-notes' },
      { id: '3', content: good.replace('release-notes', 'other-skill'), folderName: 'other-skill' }
    ])
    expect(results.map((r) => r.issues.map((i) => i.code))).toEqual([
      ['duplicate-name'],
      ['duplicate-name'],
      []
    ])
    expect(countIssues(results[0].issues)).toEqual({ error: 0, warning: 1, info: 0 })
  })
})
