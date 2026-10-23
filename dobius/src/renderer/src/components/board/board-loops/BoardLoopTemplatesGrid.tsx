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
