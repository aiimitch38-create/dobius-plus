import { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import type { DiscoveredSkill } from '../../../../../shared/skills'
import { buildSkillRunPrompt } from './board-card-extras'
import type { CardBodyProps } from './card-body-props'
import { notePushTargets, pushNoteToConsole } from './note-push'

const FIELD =
  'w-full rounded-[8px] border border-[var(--board-panel-border)] bg-transparent px-2 py-1 text-[12px] text-[var(--board-text)]'

// Runs an installed skill in a chosen board console, with arguments.
export function SkillCard({
  worktreeId,
  card,
  onChange
}: CardBodyProps<'skill'> & { worktreeId: string }): React.JSX.Element {
  const [skills, setSkills] = useState<DiscoveredSkill[] | null>(null)
  const [tabId, setTabId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const targets = notePushTargets(useAppStore((s) => getBoard(s, worktreeId)))
  const target = targets.find((t) => t.tabId === tabId) ?? targets[0] ?? null

  useEffect(() => {
    let cancelled = false
    const cwd = findWorktreeById(useAppStore.getState().worktreesByRepo, worktreeId)?.path ?? null
    window.api.skills.discover({ cwd }).then(
      (result) => !cancelled && setSkills(result.skills),
      (error: unknown) => {
        console.error('Skill discovery failed:', error)
        if (!cancelled) {
          setSkills([])
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [worktreeId])

  const run = async (): Promise<void> => {
    if (!target || !card.skillName) {
      return
    }
    setRunning(true)
    try {
      const error = await pushNoteToConsole(
        worktreeId,
        target.tabId,
        buildSkillRunPrompt(card.skillName, card.args)
      )
      if (error) {
        toast.error(error)
      } else {
        toast.success(translate('board.note.pushed', 'Sent to {{name}}', { name: target.title }))
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <select
        value={card.skillName}
        onChange={(e) =>
          onChange({ skillName: e.target.value, title: e.target.value || card.title })
        }
        aria-label={translate('board.skill.pick', 'Skill')}
        className={FIELD}
      >
        <option value="">
          {skills === null
            ? translate('board.studio.loading', 'Loading…')
            : translate('board.skill.pickPrompt', 'Pick a skill')}
        </option>
        {skills?.map((s) => (
          <option key={s.id} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
      <input
        value={card.args}
        onChange={(e) => onChange({ args: e.target.value })}
        placeholder={translate('board.skill.args', 'Arguments (optional)')}
        className={FIELD}
      />
      <div className="mt-auto flex items-center gap-2">
        <select
          value={target?.tabId ?? ''}
          onChange={(e) => setTabId(e.target.value)}
          disabled={targets.length === 0}
          aria-label={translate('board.skill.console', 'Run in')}
          className={FIELD}
        >
          {targets.length === 0 ? (
            <option value="">{translate('board.memory.noConsoles', 'No consoles')}</option>
          ) : (
            targets.map((t) => (
              <option key={t.tabId} value={t.tabId}>
                {t.title}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          disabled={running || !target || !card.skillName}
          onClick={() => void run()}
          className="flex h-7 shrink-0 items-center gap-1 rounded-full bg-[var(--board-accent)] px-3 text-[12px] font-semibold text-[var(--board-accent-fg)] disabled:opacity-40"
        >
          <Play className="size-3.5" />
          {translate('board.skill.run', 'Run')}
        </button>
      </div>
    </div>
  )
}
