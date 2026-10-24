import React, { useMemo, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { DiscoveredSkill } from '../../../../shared/skills'
import { checkupSkill, countIssues, parseSkillFile } from './skill-checkup'
import { createSkillFile, saveSkillEdit, skillFolderName, type SkillScope } from './skill-files'
import { SkillIssueList } from './SkillCheckupPanel'
import { SkillScopeSelect } from './SkillScopeSelect'

export type SkillEditorTarget =
  | { kind: 'create'; content: string }
  | { kind: 'edit'; skill: DiscoveredSkill; content: string }

/**
 * Edits one SKILL.md as text with a live checkup. New skills are written to
 * `<folder>/<name>/SKILL.md`, with name read from the frontmatter; an existing
 * file is only replaced after the user confirms.
 */
export function SkillEditorPanel({
  target,
  scopes,
  scopeId,
  onScopeChange,
  onSaved,
  onCancel
}: {
  target: SkillEditorTarget
  scopes: readonly SkillScope[]
  scopeId: string | null
  onScopeChange: (scopeId: string) => void
  onSaved: () => void
  onCancel: () => void
}): React.JSX.Element {
  const [content, setContent] = useState(target.content)
  const [saving, setSaving] = useState(false)
  const [confirmPath, setConfirmPath] = useState<string | null>(null)
  const scope = scopes.find((s) => s.id === scopeId) ?? null
  const name = parseSkillFile(content).fields?.name?.trim() ?? ''
  const folderName =
    target.kind === 'edit' ? skillFolderName(target.skill.skillFilePath) : name || undefined
  const issues = useMemo(() => checkupSkill({ content, folderName }), [content, folderName])
  const errors = countIssues(issues).error
  const canSave =
    !saving && errors === 0 && (target.kind === 'edit' || (scope !== null && name !== ''))

  const save = async (overwrite: boolean): Promise<void> => {
    setSaving(true)
    try {
      if (target.kind === 'edit') {
        await saveSkillEdit(target.skill, content)
        toast.success(
          translate('skills.saved', 'Saved {{path}}', { path: target.skill.skillFilePath })
        )
        onSaved()
        return
      }
      if (!scope) {
        return
      }
      const result = await createSkillFile({ scopePath: scope.path, name, content, overwrite })
      if (result.status === 'exists') {
        setConfirmPath(result.path)
        return
      }
      setConfirmPath(null)
      toast.success(translate('skills.saved', 'Saved {{path}}', { path: result.path }))
      onSaved()
    } catch (error) {
      toast.error(
        translate('skills.saveFailed', 'Could not save the skill: {{error}}', {
          error: error instanceof Error ? error.message : String(error)
        })
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--board-panel-border)] px-5 py-2">
        {target.kind === 'create' ? (
          <SkillScopeSelect
            scopes={scopes}
            value={scopeId}
            onChange={(id) => {
              setConfirmPath(null)
              onScopeChange(id)
            }}
          />
        ) : (
          <span
            className="min-w-0 truncate font-mono text-[11px] text-[var(--board-text-muted)]"
            title={target.skill.skillFilePath}
          >
            {target.skill.skillFilePath}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onCancel}>
            {translate('skills.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1"
            disabled={!canSave}
            onClick={() => void save(false)}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {target.kind === 'edit'
              ? translate('skills.saveChanges', 'Save changes')
              : translate('skills.create', 'Create skill')}
          </Button>
        </div>
      </div>
      {confirmPath ? (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--board-panel-border)] bg-[var(--board-danger-tint)] px-5 py-2 text-[12px] text-[var(--board-text)]"
        >
          <span className="mr-auto min-w-0">
            {translate('skills.existsAt', '{{path}} already exists. Replace it?', {
              path: confirmPath
            })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="h-7 text-[12px]"
            disabled={saving}
            onClick={() => void save(true)}
          >
            {translate('skills.replace', 'Replace')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-[12px]"
            onClick={() => setConfirmPath(null)}
          >
            {translate('skills.keepExisting', 'Keep existing')}
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4 lg:flex-row">
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            setConfirmPath(null)
          }}
          spellCheck={false}
          aria-label={translate('skills.editorLabel', 'SKILL.md contents')}
          className="scrollbar-sleek min-h-[240px] min-w-0 flex-1 resize-none rounded-[10px] border border-[var(--board-panel-border)] bg-[var(--board-panel)] p-3 font-mono text-[12px] leading-5 text-[var(--board-text)] outline-none focus:border-[var(--board-accent)]"
        />
        <aside className="flex shrink-0 flex-col gap-2 lg:w-72">
          <h3 className="text-[11px] font-semibold tracking-[0.12em] text-[var(--board-text-muted)] uppercase">
            {translate('skills.checkup.title', 'Checkup')}
          </h3>
          <SkillIssueList issues={issues} />
          {errors > 0 ? (
            <p className="text-[12px] text-[var(--board-text-muted)]">
              {translate('skills.fixErrors', 'Fix the errors above to save.')}
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
