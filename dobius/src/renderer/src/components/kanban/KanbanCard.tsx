import { Check, Image as ImageIcon, Paperclip } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { AvatarStack } from './AvatarStack'
import { ClaimedChip, BlockedChip, PriorityChip, TypeChip } from './kanban-chips'
import type { Task } from './kanban-types'

export function KanbanCard({
  task,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd
}: {
  task: Task
  dragging: boolean
  onOpen: () => void
  onDragStart: (event: React.DragEvent<HTMLButtonElement>) => void
  onDragEnd: () => void
}): React.JSX.Element {
  return (
    <Card
      className={cn(
        'block w-full border-kanban-border bg-kanban-card p-0 text-kanban-foreground shadow-kanban-card transition-[opacity,border-color,transform] hover:-translate-y-px hover:border-kanban-border-strong',
        dragging && 'opacity-35'
      )}
    >
      <button
        type="button"
        draggable
        aria-label={`Open ${task.title}`}
        className="block w-full cursor-grab rounded-[inherit] p-3 text-left outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-kanban-accent focus-visible:ring-offset-2 focus-visible:ring-offset-kanban-column"
        onClick={onOpen}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex items-start gap-2">
          {task.status === 'done' ? (
            <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-kanban-success text-kanban-success-foreground">
              <Check className="size-2.5" strokeWidth={3} />
            </span>
          ) : null}
          <h3 className="min-w-0 flex-1 text-[13px] leading-[1.3] font-semibold">{task.title}</h3>
        </div>
        {task.status !== 'done' ? (
          <>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <TypeChip type={task.type} />
              <PriorityChip priority={task.priority} />
              {task.lease ? <ClaimedChip lease={task.lease} /> : null}
              {task.status === 'blocked' && task.blockedReason ? (
                <BlockedChip reason={task.blockedReason} />
              ) : null}
            </div>
            {task.coverImageUrl ? (
              <img
                src={task.coverImageUrl}
                alt="Task cover image"
                className="mt-2.5 aspect-video w-full rounded-md border border-kanban-border object-cover object-top"
              />
            ) : null}
            <p className="mt-2.5 line-clamp-2 text-[11px] leading-[1.5] text-kanban-muted-foreground">
              {task.description}
            </p>
            {task.dispatch ? (
              <p
                className="mt-2 flex items-center gap-1.5 text-[10px] text-kanban-muted-foreground"
                title={task.dispatch.error ?? undefined}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    task.dispatch.status === 'running' && 'animate-pulse bg-kanban-accent',
                    task.dispatch.status === 'succeeded' && 'bg-kanban-success',
                    (task.dispatch.status === 'failed' || task.dispatch.status === 'dead') &&
                      'bg-kanban-red'
                  )}
                />
                <span className="truncate">
                  {task.dispatch.status === 'running'
                    ? `${task.dispatch.agentName} is working on this`
                    : task.dispatch.status === 'succeeded'
                      ? `${task.dispatch.agentName} finished — needs review`
                      : task.dispatch.status === 'dead'
                        ? `${task.dispatch.agentName} failed ${task.dispatch.attempts}x — stopped`
                        : /* Not "will retry": a failed task stays in In
                             Progress, and dispatch only picks up To Do, so
                             nothing re-runs until a human moves it back. */
                          `${task.dispatch.agentName} failed — move to To Do to retry`}
                </span>
                {typeof task.dispatch.costUsd === 'number' ? (
                  <span className="shrink-0 tabular-nums">
                    ${task.dispatch.costUsd.toFixed(2)}
                  </span>
                ) : null}
              </p>
            ) : null}
            <footer className="mt-3 flex items-center gap-3 text-[11px] tabular-nums text-kanban-muted-foreground">
              <span className="flex items-center gap-1">
                <Paperclip className="size-3.5" />
                {task.files.length}
              </span>
              {task.attachments?.length ? (
                <span
                  className="flex items-center gap-1"
                  title={`${task.attachments.length} screenshot(s)`}
                >
                  <ImageIcon className="size-3.5" />
                  {task.attachments.length}
                </span>
              ) : null}
              <div className="ml-auto">
                <AvatarStack people={task.collaborators} />
              </div>
            </footer>
          </>
        ) : null}
      </button>
    </Card>
  )
}
