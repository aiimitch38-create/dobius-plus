import React from 'react'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { addCardAtViewCenter } from './add-card-at-view-center'
import { SkillsPage } from './board-studio-lazy-pages'
import { useStudioCloseOverride } from './use-studio-close-override'

export function SkillsStudio({
  worktreeId,
  onClose
}: {
  worktreeId: string | null
  onClose: () => void
}): React.JSX.Element {
  useStudioCloseOverride('closeSkillsPage', onClose)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {worktreeId ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--board-panel-border)] px-5 py-2">
          <span className="text-[12px] text-[var(--board-text-muted)]">
            {translate(
              'board.skill.cardHint',
              'Run a skill in a board console with arguments from a skill card.'
            )}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              addCardAtViewCenter(worktreeId, 'skill')
              onClose()
            }}
          >
            <Play className="size-3.5" />
            {translate('board.skill.addCard', 'Skill card on board')}
          </Button>
        </div>
      ) : null}
      <SkillsPage />
    </div>
  )
}
