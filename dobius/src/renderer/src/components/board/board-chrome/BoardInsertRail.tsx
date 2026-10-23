import React from 'react'
import {
  CalendarDays,
  FileText,
  FolderOpen,
  Kanban,
  Layers,
  ListChecks,
  ListTodo,
  Network,
  NotebookPen,
  Repeat2
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { BoardRailButton } from './BoardRailButton'
import { BOARD_FLOATING_PANEL_CLASS, BOARD_ICON_BUTTON_CLASS } from './board-surface-classes'
import type { BoardInsertKind } from './board-tools'

export type BoardInsertRailProps = {
  onInsert: (kind: BoardInsertKind) => void
}

function RailDivider(): React.JSX.Element {
  return <div className="mx-auto my-[0.5px] h-px w-6 bg-[var(--board-panel-border)]" />
}

export function BoardInsertRail({ onInsert }: BoardInsertRailProps): React.JSX.Element {
  const checklistLabel = translate('board.insert.checklist', 'Checklist')
  const item = (kind: BoardInsertKind, label: string, icon: React.ReactNode): React.JSX.Element => (
    <BoardRailButton key={kind} label={label} tooltipSide="left" onClick={() => onInsert(kind)}>
      {icon}
    </BoardRailButton>
  )

  return (
    <nav
      aria-label={translate('board.insert.railLabel', 'Insert')}
      className={cn(
        BOARD_FLOATING_PANEL_CLASS,
        'pointer-events-auto absolute top-1/2 right-4 flex -translate-y-1/2 flex-col gap-1.5 rounded-full p-1.5 [&>*]:shrink-0 [&_svg]:size-[18px]'
      )}
    >
      {item('presets', translate('board.insert.presets', 'Layers and presets'), <Layers />)}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={checklistLabel}
                className={BOARD_ICON_BUTTON_CLASS}
              >
                <ListChecks />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={6}>
            {checklistLabel}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="left" align="start" sideOffset={8}>
          <DropdownMenuItem onSelect={() => onInsert('todo')}>
            <ListTodo />
            {translate('board.insert.todo', 'To-do list')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onInsert('kanban')}>
            <Kanban />
            {translate('board.insert.kanban', 'Kanban')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onInsert('calendar')}>
            <CalendarDays />
            {translate('board.insert.calendar', 'Calendar')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {item('orchestrator', translate('board.insert.orchestrator', 'Orchestrator'), <Network />)}
      <RailDivider />
      {item('code', translate('board.insert.code', 'Browse code'), <FolderOpen />)}
      {item('docs', translate('board.insert.docs', 'Markdown docs'), <FileText />)}
      {item(
        'generate-doc',
        translate('board.insert.generateDoc', 'Generate document'),
        <NotebookPen />
      )}
      <RailDivider />
      {item('loops', translate('board.insert.loops', 'Loops'), <Repeat2 />)}
    </nav>
  )
}
