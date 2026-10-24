import React, { useState } from 'react'
import { Check, Loader2, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { createSkillFile, type SkillScope } from './skill-files'
import { SKILL_STARTERS, starterSkillMarkdown, type SkillStarter } from './skill-starters'
import { SkillScopeSelect } from './SkillScopeSelect'

type StarterState = 'idle' | 'saving' | 'confirm' | 'added'

/** Twelve starter skills, each one click to add into the chosen folder. */
export function SkillStartersPanel({
  scopes,
  scopeId,
  onScopeChange,
  onCustomize,
  onAdded
}: {
  scopes: readonly SkillScope[]
  scopeId: string | null
  onScopeChange: (scopeId: string) => void
  onCustomize: (content: string) => void
  onAdded: () => void
}): React.JSX.Element {
  const [states, setStates] = useState<Record<string, StarterState>>({})
  const scope = scopes.find((s) => s.id === scopeId) ?? null
  const setState = (id: string, state: StarterState): void =>
    setStates((current) => ({ ...current, [id]: state }))

  const add = async (item: SkillStarter, overwrite: boolean): Promise<void> => {
    if (!scope) {
      return
    }
    setState(item.id, 'saving')
    try {
      const result = await createSkillFile({
        scopePath: scope.path,
        name: item.name,
        content: starterSkillMarkdown(item),
        overwrite
      })
      if (result.status === 'exists') {
        setState(item.id, 'confirm')
        return
      }
      setState(item.id, 'added')
      toast.success(translate('skills.saved', 'Saved {{path}}', { path: result.path }))
      onAdded()
    } catch (error) {
      setState(item.id, 'idle')
      toast.error(
        translate('skills.saveFailed', 'Could not save the skill: {{error}}', {
          error: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--board-panel-border)] px-5 py-2">
        <SkillScopeSelect scopes={scopes} value={scopeId} onChange={onScopeChange} />
      </div>
      <ul className="scrollbar-sleek mx-auto grid min-h-0 w-full max-w-5xl flex-1 auto-rows-min grid-cols-1 gap-2 overflow-y-auto px-5 py-4 md:grid-cols-2">
        {SKILL_STARTERS.map((item) => {
          const state = states[item.id] ?? 'idle'
          return (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-[10px] border border-[var(--board-panel-border)] bg-[var(--board-panel)] p-3"
            >
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-[var(--board-text)]">
                  {item.title}{' '}
                  <span className="font-mono text-[11px] font-normal text-[var(--board-text-muted)]">
                    {item.name}
                  </span>
                </h3>
                <p className="mt-0.5 text-[12px] leading-5 text-[var(--board-text-muted)]">
                  {item.description}
                </p>
              </div>
              <div className="mt-auto flex items-center gap-1.5">
                {state === 'confirm' ? (
                  <>
                    <span className="mr-auto text-[12px] text-[var(--board-text)]">
                      {translate(
                        'skills.existsConfirm',
                        'A skill with this name exists. Replace it?'
                      )}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="h-7 text-[12px]"
                      onClick={() => void add(item, true)}
                    >
                      {translate('skills.replace', 'Replace')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[12px]"
                      onClick={() => setState(item.id, 'idle')}
                    >
                      {translate('skills.cancel', 'Cancel')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-[12px]"
                      disabled={!scope || state === 'saving' || state === 'added'}
                      onClick={() => void add(item, false)}
                    >
                      {state === 'saving' ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : state === 'added' ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Plus className="size-3.5" />
                      )}
                      {state === 'added'
                        ? translate('skills.added', 'Added')
                        : translate('skills.add', 'Add')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-[12px]"
                      onClick={() => onCustomize(starterSkillMarkdown(item))}
                    >
                      <Pencil className="size-3.5" />
                      {translate('skills.customize', 'Customize')}
                    </Button>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
