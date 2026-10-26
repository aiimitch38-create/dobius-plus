import React from 'react'
import {
  Activity,
  Clock,
  Eye,
  FlaskConical,
  GitCommit,
  LifeBuoy,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { BOARD_LOOP_TEMPLATES, type BoardLoopTemplate } from './board-loop-templates'

const ICONS: Record<BoardLoopTemplate['icon'], LucideIcon> = {
  activity: Activity,
  zap: Zap,
  'life-buoy': LifeBuoy,
  'flask-conical': FlaskConical,
  'git-commit': GitCommit,
  eye: Eye,
  clock: Clock
}

/** Template cards; picking one opens the loop form pre-filled (nothing runs until saved). */
export function BoardLoopTemplatesGrid({
  disabled,
  onPick
}: {
  disabled: boolean
  onPick: (template: BoardLoopTemplate) => void
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold tracking-[0.12em] text-[var(--board-text-muted)] uppercase">
        {translate('board.loops.templates', 'Templates')}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BOARD_LOOP_TEMPLATES.map((template) => {
          const Icon = ICONS[template.icon]
          return (
            <button
              key={template.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick(template)}
              className="flex flex-col gap-2 rounded-[14px] border border-[var(--board-panel-border)] bg-[var(--board-panel-2)] p-4 text-left transition-colors hover:border-[var(--board-accent)] disabled:cursor-not-allowed disabled:opacity-80 disabled:hover:border-[var(--board-panel-border)]"
            >
              <span className="flex items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-[var(--board-accent-tint)] text-[var(--board-accent)]">
                  <Icon aria-hidden className="size-4" />
                </span>
                <span className="text-[14px] font-semibold text-[var(--board-text)]">
                  {template.title}
                </span>
              </span>
              <span className="text-[13px] leading-snug text-[var(--board-text-muted)]">
                {template.description}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** The same templates as a scrollable pill row at the top of the form (selected = solid accent). */
export function BoardLoopTemplatePills({
  selectedId,
  onPick
}: {
  selectedId: string | null
  onPick: (template: BoardLoopTemplate) => void
}): React.JSX.Element {
  return (
    <div className="scrollbar-sleek -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {BOARD_LOOP_TEMPLATES.map((template) => {
        const Icon = ICONS[template.icon]
        const selected = template.id === selectedId
        return (
          <button
            key={template.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(template)}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors',
              selected
                ? 'border-[var(--board-accent)] bg-[var(--board-accent)] text-[var(--board-accent-fg)]'
                : 'border-[var(--board-panel-border)] bg-[var(--board-panel)] text-[var(--board-text)] hover:border-[var(--board-text-muted)]'
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {template.title}
          </button>
        )
      })}
    </div>
  )
}
