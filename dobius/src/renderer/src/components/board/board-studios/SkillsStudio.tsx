import React, { useEffect, useMemo, useState } from 'react'
import { Play, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import type { DiscoveredSkill } from '../../../../../shared/skills'
import { SkillCheckupPanel } from '@/components/skills/SkillCheckupPanel'
import { SkillEditorPanel, type SkillEditorTarget } from '@/components/skills/SkillEditorPanel'
import { skillScopes, useSkillDiscovery } from '@/components/skills/skill-files'
import { skillScanErrorMessage } from '@/components/skills/skills-scan'
import {
  buildSkillMarkdown,
  duplicateSkillName,
  renameSkillMarkdown
} from '@/components/skills/skill-starters'
import { SkillStartersPanel } from '@/components/skills/SkillStartersPanel'
import { addCardAtViewCenter } from './add-card-at-view-center'
import { SkillsPage } from './board-studio-lazy-pages'
import { useStudioCloseOverride } from './use-studio-close-override'

type SkillsTab = 'browse' | 'checkup' | 'starters'

const EMPTY_SKILLS: DiscoveredSkill[] = []

function newSkillTemplate(): string {
  return buildSkillMarkdown({
    name: 'my-skill',
    description: 'Say what this skill does and when an agent should use it.',
    body: '# My skill\n\n1. First step.\n2. Second step.'
  })
}

export function SkillsStudio({
  worktreeId,
  onClose
}: {
  worktreeId: string | null
  onClose: () => void
}): React.JSX.Element {
  useStudioCloseOverride('closeSkillsPage', onClose)
  const worktreePath = useAppStore((s) =>
    worktreeId ? (findWorktreeById(s.worktreesByRepo, worktreeId)?.path ?? null) : null
  )
  const [tab, setTab] = useState<SkillsTab>('browse')
  const [editor, setEditor] = useState<SkillEditorTarget | null>(null)
  const [scopeId, setScopeId] = useState<string | null>(null)
  const discovery = useSkillDiscovery(worktreePath)
  const scopes = useMemo(() => skillScopes(discovery.result?.sources ?? []), [discovery.result])
  const skills = discovery.result?.skills ?? EMPTY_SKILLS

  useEffect(() => {
    if (!scopeId && scopes.length > 0) {
      setScopeId(scopes[0].id)
    }
  }, [scopeId, scopes])

  useEffect(() => {
    if (discovery.error && tab !== 'browse') {
      toast.error(skillScanErrorMessage(discovery.error))
    }
  }, [discovery.error, tab])

  const tabs: { id: SkillsTab; label: string }[] = [
    { id: 'browse', label: translate('skills.tab.browse', 'Browse') },
    { id: 'checkup', label: translate('skills.tab.checkup', 'Checkup') },
    { id: 'starters', label: translate('skills.tab.starters', 'Starters') }
  ]

  let body: React.ReactNode
  if (editor) {
    body = (
      <SkillEditorPanel
        key={editor.kind === 'edit' ? editor.skill.id : editor.content}
        target={editor}
        scopes={scopes}
        scopeId={scopeId}
        onScopeChange={setScopeId}
        onCancel={() => setEditor(null)}
        onSaved={() => {
          setEditor(null)
          discovery.reload()
        }}
      />
    )
  } else if (tab === 'checkup') {
    body = (
      <SkillCheckupPanel
        skills={skills}
        loading={discovery.loading}
        onEdit={(skill, content) => setEditor({ kind: 'edit', skill, content })}
        onDuplicate={(skill, content) =>
          setEditor({
            kind: 'create',
            content: renameSkillMarkdown(
              content,
              duplicateSkillName(
                skill.name,
                skills.map((s) => s.name)
              )
            )
          })
        }
      />
    )
  } else if (tab === 'starters') {
    body = (
      <SkillStartersPanel
        scopes={scopes}
        scopeId={scopeId}
        onScopeChange={setScopeId}
        onCustomize={(content) => setEditor({ kind: 'create', content })}
        onAdded={discovery.reload}
      />
    )
  } else {
    body = <SkillsPage />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--board-panel-border)] px-5 py-2">
        <div role="tablist" className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={!editor && tab === t.id}
              onClick={() => {
                setEditor(null)
                setTab(t.id)
              }}
              className={cn(
                'rounded-full px-3 py-1 text-[12px] text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)]',
                !editor &&
                  tab === t.id &&
                  'bg-[var(--board-accent-tint)] font-semibold text-[var(--board-text)]'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditor({ kind: 'create', content: newSkillTemplate() })}
          >
            <Plus className="size-3.5" />
            {translate('skills.new', 'New skill')}
          </Button>
          {worktreeId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              title={translate(
                'board.skill.cardHint',
                'Run a skill in a board console with arguments from a skill card.'
              )}
              onClick={() => {
                addCardAtViewCenter(worktreeId, 'skill')
                onClose()
              }}
            >
              <Play className="size-3.5" />
              {translate('board.skill.addCard', 'Skill card on board')}
            </Button>
          ) : null}
        </div>
      </div>
      {body}
    </div>
  )
}
