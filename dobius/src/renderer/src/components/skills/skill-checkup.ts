// Skills "Checkup": a local, no-AI linter over SKILL.md files. Pure: callers
// pass the file text and its folder name, and get a list of findings back.
import { translate } from '@/i18n/i18n'
import { parseSkillFile } from './skill-frontmatter'

export { parseSkillFile, type ParsedSkillFile } from './skill-frontmatter'

export type SkillIssueSeverity = 'error' | 'warning' | 'info'

export type SkillIssueCode =
  | 'no-frontmatter'
  | 'unclosed-frontmatter'
  | 'missing-name'
  | 'name-format'
  | 'name-too-long'
  | 'name-reserved'
  | 'name-folder-mismatch'
  | 'missing-description'
  | 'description-too-long'
  | 'description-too-short'
  | 'description-xml'
  | 'claude-code-only-field'
  | 'unknown-field'
  | 'empty-body'
  | 'long-body'
  | 'duplicate-name'

export type SkillIssue = {
  code: SkillIssueCode
  severity: SkillIssueSeverity
  /** Localized plain-English explanation; the UI shows it as-is. */
  message: string
  field?: string
}

export const SKILL_NAME_MAX = 64
export const SKILL_DESCRIPTION_MAX = 1024
export const SKILL_DESCRIPTION_MIN = 20
export const SKILL_BODY_LINE_HINT = 500
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RESERVED_WORDS = ['anthropic', 'claude']

/** Fields of the open Agent Skills format every skill-aware agent reads. */
const PORTABLE_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata'])
/** Fields only Claude Code acts on; other agents load the skill and ignore them. */
export const CLAUDE_CODE_ONLY_FIELDS = new Set([
  'allowed-tools',
  'model',
  'disable-model-invocation',
  'user-invocable',
  'argument-hint',
  'when_to_use',
  'context',
  'agent',
  'hooks',
  'version'
])

const issue = (
  code: SkillIssueCode,
  severity: SkillIssueSeverity,
  message: string,
  field?: string
): SkillIssue => (field ? { code, severity, message, field } : { code, severity, message })

/** Lints one SKILL.md. `folderName` is the directory that holds it. */
export function checkupSkill(args: { content: string; folderName?: string }): SkillIssue[] {
  const parsed = parseSkillFile(args.content)
  if (parsed.unclosed) {
    return [
      issue(
        'unclosed-frontmatter',
        'error',
        translate(
          'skills.checkup.unclosedFrontmatter',
          'The frontmatter block opens with --- but never closes. Add a closing --- line.'
        )
      )
    ]
  }
  if (!parsed.fields) {
    return [
      issue(
        'no-frontmatter',
        'error',
        translate(
          'skills.checkup.noFrontmatter',
          'No frontmatter. Start the file with a --- block that has name and description.'
        )
      )
    ]
  }
  const issues: SkillIssue[] = []
  const name = parsed.fields.name?.trim() ?? ''
  const description = parsed.fields.description?.trim() ?? ''

  if (!name) {
    issues.push(
      issue(
        'missing-name',
        'error',
        translate('skills.checkup.missingName', 'Missing the required name field.'),
        'name'
      )
    )
  } else {
    if (!NAME_RE.test(name)) {
      issues.push(
        issue(
          'name-format',
          'error',
          translate(
            'skills.checkup.nameFormat',
            'Name must be lowercase letters, numbers and single hyphens (for example "release-notes").'
          ),
          'name'
        )
      )
    }
    if (name.length > SKILL_NAME_MAX) {
      issues.push(
        issue(
          'name-too-long',
          'error',
          translate(
            'skills.checkup.nameTooLong',
            'Name is {{count}} characters; the limit is {{max}}.',
            { count: name.length, max: SKILL_NAME_MAX }
          ),
          'name'
        )
      )
    }
    const reserved = RESERVED_WORDS.find((word) => name.toLowerCase().includes(word))
    if (reserved) {
      issues.push(
        issue(
          'name-reserved',
          'warning',
          translate('skills.checkup.nameReserved', 'Name contains the reserved word "{{word}}".', {
            word: reserved
          }),
          'name'
        )
      )
    }
    if (args.folderName && args.folderName !== name) {
      issues.push(
        issue(
          'name-folder-mismatch',
          'warning',
          translate(
            'skills.checkup.nameFolderMismatch',
            'Name "{{name}}" does not match its folder "{{folder}}". Some agents look skills up by folder.',
            { name, folder: args.folderName }
          ),
          'name'
        )
      )
    }
  }

  if (!description) {
    issues.push(
      issue(
        'missing-description',
        'error',
        translate(
          'skills.checkup.missingDescription',
          'Missing the required description field. Agents read it to decide when to use the skill.'
        ),
        'description'
      )
    )
  } else {
    if (description.length > SKILL_DESCRIPTION_MAX) {
      issues.push(
        issue(
          'description-too-long',
          'error',
          translate(
            'skills.checkup.descriptionTooLong',
            'Description is {{count}} characters; the limit is {{max}}.',
            { count: description.length, max: SKILL_DESCRIPTION_MAX }
          ),
          'description'
        )
      )
    } else if (description.length < SKILL_DESCRIPTION_MIN) {
      issues.push(
        issue(
          'description-too-short',
          'warning',
          translate(
            'skills.checkup.descriptionTooShort',
            'Description is very short. Say what the skill does and when to use it.'
          ),
          'description'
        )
      )
    }
    if (/<\/?[A-Za-z][^>]*>/.test(description)) {
      issues.push(
        issue(
          'description-xml',
          'warning',
          translate('skills.checkup.descriptionXml', 'Description contains XML or HTML tags.'),
          'description'
        )
      )
    }
  }

  for (const key of parsed.keys) {
    if (CLAUDE_CODE_ONLY_FIELDS.has(key)) {
      issues.push(
        issue(
          'claude-code-only-field',
          'info',
          translate(
            'skills.checkup.claudeCodeOnly',
            '"{{field}}" only works in Claude Code; other agents ignore it.',
            { field: key }
          ),
          key
        )
      )
    } else if (!PORTABLE_FIELDS.has(key)) {
      issues.push(
        issue(
          'unknown-field',
          'info',
          translate('skills.checkup.unknownField', '"{{field}}" is not a known skill field.', {
            field: key
          }),
          key
        )
      )
    }
  }

  const body = parsed.body.trim()
  if (!body) {
    issues.push(
      issue(
        'empty-body',
        'warning',
        translate(
          'skills.checkup.emptyBody',
          'The skill has no instructions below the frontmatter.'
        )
      )
    )
  } else {
    const lineCount = body.split('\n').length
    if (lineCount > SKILL_BODY_LINE_HINT) {
      issues.push(
        issue(
          'long-body',
          'info',
          translate(
            'skills.checkup.longBody',
            'SKILL.md is {{count}} lines. Consider moving detail into separate files the skill links to.',
            { count: lineCount }
          )
        )
      )
    }
  }
  return issues
}

export type SkillCheckupInput = { id: string; content: string; folderName?: string }
export type SkillCheckupResult = { id: string; name: string | null; issues: SkillIssue[] }

/** Lints a set of skills and flags names used by more than one of them. */
export function checkupSkills(skills: readonly SkillCheckupInput[]): SkillCheckupResult[] {
  const results = skills.map((s) => ({
    id: s.id,
    name: parseSkillFile(s.content).fields?.name?.trim() || null,
    issues: checkupSkill(s)
  }))
  const counts = new Map<string, number>()
  for (const r of results) {
    if (r.name) {
      counts.set(r.name, (counts.get(r.name) ?? 0) + 1)
    }
  }
  for (const r of results) {
    const count = r.name ? (counts.get(r.name) ?? 0) : 0
    if (count > 1) {
      r.issues.push(
        issue(
          'duplicate-name',
          'warning',
          translate(
            'skills.checkup.duplicateName',
            '{{count}} skills are named "{{name}}". Agents may load the wrong one.',
            { count, name: r.name ?? '' }
          ),
          'name'
        )
      )
    }
  }
  return results
}

export function countIssues(issues: readonly SkillIssue[]): Record<SkillIssueSeverity, number> {
  const out: Record<SkillIssueSeverity, number> = { error: 0, warning: 0, info: 0 }
  for (const i of issues) {
    out[i.severity] += 1
  }
  return out
}
