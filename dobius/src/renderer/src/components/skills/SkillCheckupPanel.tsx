import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Copy, Info, Loader2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { DiscoveredSkill } from '../../../../shared/skills'
import {
  checkupSkills,
  countIssues,
  type SkillIssue,
  type SkillIssueSeverity
} from './skill-checkup'
import { isEditableSkill, readSkillFile, skillFolderName } from './skill-files'

const SEVERITY_ICON: Record<SkillIssueSeverity, React.ComponentType<{ className?: string }>> = {
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info
}
const SEVERITY_CLASS: Record<SkillIssueSeverity, string> = {
  error: 'text-[var(--board-danger-text)]',
  warning: 'text-[var(--board-text)]',
  info: 'text-[var(--board-text-muted)]'
}

export function SkillIssueList({ issues }: { issues: readonly SkillIssue[] }): React.JSX.Element {
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-[12px] text-[var(--board-text-muted)]">
        <CheckCircle2 className="size-3.5 text-[var(--board-accent)]" />
        {translate('skills.checkup.clean', 'No problems found.')}
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-1">
      {issues.map((issue, i) => {
        const Icon = SEVERITY_ICON[issue.severity]
        return (
          <li
            key={`${issue.code}-${i}`}
            className={cn('flex items-start gap-1.5 text-[12px]', SEVERITY_CLASS[issue.severity])}
          >
            <Icon className="mt-0.5 size-3.5 shrink-0" />
            <span>{issue.message}</span>
          </li>
        )
      })}
    </ul>
  )
}

type Row = { skill: DiscoveredSkill; content: string | null; readError: string | null }

/** Checkup: lints every discovered SKILL.md locally and lists findings per skill. */
export function SkillCheckupPanel({
  skills,
  loading,
  onEdit,
  onDuplicate
}: {
  skills: readonly DiscoveredSkill[]
  loading: boolean
  onEdit: (skill: DiscoveredSkill, content: string) => void
  onDuplicate: (skill: DiscoveredSkill, content: string) => void
}): React.JSX.Element {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [onlyProblems, setOnlyProblems] = useState(false)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    void Promise.all(
      skills.map(async (skill): Promise<Row> => {
        try {
          return { skill, content: await readSkillFile(skill), readError: null }
        } catch (error) {
          return {
            skill,
            content: null,
            readError: error instanceof Error ? error.message : String(error)
          }
        }
      })
    ).then((next) => {
      if (!cancelled) {
        setRows(next)
      }
    })
    return () => {
      cancelled = true
    }
  }, [skills])

  const results = useMemo(() => {
    if (!rows) {
      return null
    }
    const readable = rows.filter((r) => r.content !== null)
    const byId = new Map(
      checkupSkills(
        readable.map((r) => ({
          id: r.skill.id,
          content: r.content ?? '',
          folderName: skillFolderName(r.skill.skillFilePath)
        }))
      ).map((r) => [r.id, r.issues])
    )
    return rows.map((row) => ({ ...row, issues: byId.get(row.skill.id) ?? [] }))
  }, [rows])

  if (loading || !results) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-[var(--board-text-muted)]">
        <Loader2 className="size-4 animate-spin" />
        {translate('skills.checkup.running', 'Checking skills…')}
      </div>
    )
  }

  const totals = countIssues(results.flatMap((r) => r.issues))
  const shown = onlyProblems
    ? results.filter((r) => r.readError || r.issues.some((i) => i.severity !== 'info'))
    : results

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--board-panel-border)] px-5 py-2 text-[12px] text-[var(--board-text-muted)]">
        <span>
          {translate(
            'skills.checkup.summary',
            '{{skills}} skills · {{errors}} errors · {{warnings}} warnings · {{infos}} notes',
            {
              skills: results.length,
              errors: totals.error,
              warnings: totals.warning,
              infos: totals.info
            }
          )}
        </span>
        <label className="ml-auto flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={onlyProblems}
            onChange={(e) => setOnlyProblems(e.target.checked)}
          />
          {translate('skills.checkup.onlyProblems', 'Only skills with problems')}
        </label>
      </div>
      <ul className="scrollbar-sleek mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-2 overflow-y-auto px-5 py-4">
        {shown.length === 0 ? (
          <li className="py-8 text-center text-[12px] text-[var(--board-text-muted)]">
            {translate('skills.checkup.none', 'Nothing to show.')}
          </li>
        ) : null}
        {shown.map(({ skill, content, readError, issues }) => (
          <li
            key={skill.id}
            className="rounded-[10px] border border-[var(--board-panel-border)] bg-[var(--board-panel)] p-3"
          >
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[13px] font-semibold text-[var(--board-text)]">
                  {skill.name}
                </h3>
                <p
                  className="truncate font-mono text-[11px] text-[var(--board-text-muted)]"
                  title={skill.skillFilePath}
                >
                  {skill.skillFilePath}
                </p>
              </div>
              {content !== null ? (
                <div className="flex shrink-0 gap-1">
                  {isEditableSkill(skill) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-[12px]"
                      onClick={() => onEdit(skill, content)}
                    >
                      <Pencil className="size-3.5" />
                      {translate('skills.edit', 'Edit')}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-[12px]"
                    onClick={() => onDuplicate(skill, content)}
                  >
                    <Copy className="size-3.5" />
                    {translate('skills.duplicate', 'Duplicate')}
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="mt-2">
              {readError ? (
                <p className="text-[12px] text-[var(--board-danger-text)]">
                  {translate('skills.checkup.readFailed', 'Could not read SKILL.md: {{error}}', {
                    error: readError
                  })}
                </p>
              ) : (
                <SkillIssueList issues={issues} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
