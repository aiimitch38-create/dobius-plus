import { useState } from 'react'
import { ChefHat } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import type { VertexTask, VertexTaskKitchen } from '../../../../shared/vertex-task-types'
import { openAutoFixConsole } from './BugAutoFixMarker'

function label(kitchen: VertexTaskKitchen): string {
  switch (kitchen.status) {
    case 'marked':
      return translate(
        'kanban.kitchen.marked',
        'In the kitchen queue: starts when the kitchen is on, the crew is running and a cook is free'
      )
    case 'starting':
      return translate('kanban.kitchen.starting', 'Starting a cook…')
    case 'cooking':
      return kitchen.branch
        ? translate('kanban.kitchen.cookingOn', 'A cook is working on {{branch}}', {
            branch: kitchen.branch
          })
        : translate('kanban.kitchen.cooking', 'A cook is working on this')
    case 'review':
      return translate('kanban.kitchen.review', 'Cook finished; review its branch')
    case 'blocked':
      return translate('kanban.kitchen.blocked', 'Cook stopped: {{reason}}', {
        reason: kitchen.reason ?? ''
      })
    case 'stopped':
      return translate('kanban.kitchen.stopped', 'Cook stopped because the card was moved')
    case 'failed':
      return translate('kanban.kitchen.failed', 'Not sent to the kitchen: {{reason}}', {
        reason: kitchen.reason ?? ''
      })
  }
}

const LINK = 'shrink-0 font-medium text-kanban-accent underline-offset-2 hover:underline'

/** Carson's opt-in for the kitchen manager, and what the kitchen did with the
 *  card. Outside the card's main button: a button may not sit inside another. */
export function KitchenMarker({
  task
}: {
  task: Pick<VertexTask, 'id' | 'status' | 'kitchen'>
}): React.JSX.Element | null {
  const kitchenOn = useAppStore((s) => s.settings?.kitchenEnabled === true)
  // Why: the board re-reads its cards every few seconds; until then the
  // answer from main is shown, so a click is seen at once.
  const [answer, setAnswer] = useState<{
    seen: VertexTaskKitchen | undefined
    kitchen: VertexTaskKitchen | undefined
  } | null>(null)
  const kitchen = answer && answer.seen === task.kitchen ? answer.kitchen : task.kitchen

  const set = (on: boolean): void => {
    void window.api.vertexTasks
      .setKitchen(task.id, on)
      .then((updated) => {
        if (updated) {
          setAnswer({ seen: task.kitchen, kitchen: updated.kitchen })
        }
      })
      .catch((error) => console.warn('Kitchen mark failed:', error))
  }

  if (!kitchen) {
    // Why hidden while off: an offer on every card would be noise until Carson turns the kitchen on.
    if (!kitchenOn || (task.status !== 'backlog' && task.status !== 'todo')) {
      return null
    }
    return (
      <div data-testid="kanban-card-kitchen" className="px-3 pb-3 text-[10px]">
        <button type="button" onClick={() => set(true)} className={LINK}>
          {translate('kanban.kitchen.send', 'Send to kitchen')}
        </button>
      </div>
    )
  }
  const worktreeId = kitchen.worktreeId
  return (
    <div
      data-testid="kanban-card-kitchen"
      className="flex items-center gap-1.5 px-3 pb-3 text-[10px] text-kanban-muted-foreground"
      title={kitchen.reason ?? undefined}
    >
      <ChefHat
        aria-hidden
        className={cn(
          'size-3 shrink-0',
          (kitchen.status === 'failed' || kitchen.status === 'blocked') && 'text-kanban-red',
          (kitchen.status === 'starting' || kitchen.status === 'cooking') && 'text-kanban-accent'
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label(kitchen)}</span>
      {kitchen.status === 'marked' || kitchen.status === 'failed' ? (
        <button type="button" onClick={() => set(false)} className={LINK}>
          {translate('kanban.kitchen.remove', 'Remove')}
        </button>
      ) : worktreeId ? (
        <button type="button" onClick={() => openAutoFixConsole(worktreeId)} className={LINK}>
          {translate('kanban.autoFix.openConsole', 'Open console')}
        </button>
      ) : null}
    </div>
  )
}
