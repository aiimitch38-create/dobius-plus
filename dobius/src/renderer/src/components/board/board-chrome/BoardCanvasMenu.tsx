import React from 'react'
import {
  BoxSelect,
  Brain,
  CalendarDays,
  Columns3,
  CopyPlus,
  GitBranch,
  Globe,
  Image,
  Layers,
  ListChecks,
  Maximize2,
  Network,
  Search,
  Sparkle,
  Sparkles,
  Trash2,
  Users,
  Workflow
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  BOARD_MENU_CONTENT_CLASS,
  BOARD_MENU_ROW_CLASS,
  BOARD_MENU_SEPARATOR_CLASS
} from './board-surface-classes'

const MENU_KEYCAP_CLASS =
  'min-w-0 rounded-[5px] border-[var(--board-panel-border)] bg-transparent px-1 py-0 text-[11px] text-[var(--board-text-muted)] shadow-none'

export type BoardCanvasMenuAction =
  | 'duplicate'
  | 'bringToFront'
  | 'delete'
  | 'spawn'
  | 'spawnGroup'
  | 'image'
  | 'web'
  | 'todo'
  | 'kanban'
  | 'calendar'
  | 'shape'
  | 'memory'
  | 'skill'
  | 'branches'
  | 'missionMap'
  | 'selectAll'
  | 'fit'
  | 'zoom100'

type BoardCanvasMenuProps = {
  /** Canvas-local screen point of the right-click, or null when closed. */
  at: { x: number; y: number } | null
  /** Card actions (duplicate / front / delete) apply to the current selection. */
  hasSelection: boolean
  onAction: (action: BoardCanvasMenuAction) => void
  onClose: () => void
}

type Entry = {
  action: BoardCanvasMenuAction
  icon: React.ReactNode
  label: string
  keys?: string[]
  danger?: boolean
  disabled?: boolean
}

// Right-click on the canvas, in the reference's three sections. Inserts land at
// the right-click point.
export function BoardCanvasMenu({
  at,
  hasSelection,
  onAction,
  onClose
}: BoardCanvasMenuProps): React.JSX.Element | null {
  if (!at) {
    return null
  }
  const mod = navigator.userAgent.includes('Mac') ? '⌘' : 'Ctrl'

  const card: Entry[] = [
    {
      action: 'duplicate',
      icon: <CopyPlus />,
      label: translate('board.canvasMenu.duplicate', 'Duplicate'),
      keys: [mod, 'D'],
      disabled: !hasSelection
    },
    {
      action: 'bringToFront',
      icon: <Layers />,
      label: translate('board.canvasMenu.bringToFront', 'Bring to front'),
      disabled: !hasSelection
    },
    {
      action: 'delete',
      icon: <Trash2 />,
      label: translate('board.canvasMenu.delete', 'Delete'),
      danger: true,
      disabled: !hasSelection
    }
  ]
  const create: Entry[] = [
    {
      action: 'spawn',
      icon: <Sparkles />,
      label: translate('board.canvasMenu.spawn', 'Spawn agent')
    },
    {
      action: 'spawnGroup',
      icon: <Users />,
      label: translate('board.canvasMenu.spawnGroup', 'Spawn group')
    },
    {
      action: 'image',
      icon: <Image />,
      label: translate('board.canvasMenu.image', 'Insert image')
    },
    { action: 'web', icon: <Globe />, label: translate('board.canvasMenu.web', 'Insert web') },
    {
      action: 'todo',
      icon: <ListChecks />,
      label: translate('board.canvasMenu.todo', 'Insert checklist')
    },
    {
      action: 'kanban',
      icon: <Columns3 />,
      label: translate('board.canvasMenu.kanban', 'Insert board')
    },
    {
      action: 'calendar',
      icon: <CalendarDays />,
      label: translate('board.canvasMenu.calendar', 'Insert calendar')
    },
    {
      action: 'shape',
      icon: <Workflow />,
      label: translate('board.canvasMenu.shape', 'Insert flow shapes')
    }
  ]
  const view: Entry[] = [
    {
      action: 'selectAll',
      icon: <BoxSelect />,
      label: translate('board.canvasMenu.selectAll', 'Select all'),
      keys: [mod, 'A']
    },
    {
      action: 'fit',
      icon: <Maximize2 />,
      label: translate('board.canvasMenu.fit', 'Fit to content')
    },
    {
      action: 'zoom100',
      icon: <Search />,
      label: translate('board.canvasMenu.zoom100', 'Zoom to 100%')
    }
  ]

  const row = (e: Entry): React.JSX.Element => (
    <DropdownMenuItem
      key={e.action}
      disabled={e.disabled}
      onSelect={() => onAction(e.action)}
      className={cn(
        BOARD_MENU_ROW_CLASS,
        e.danger &&
          'text-[var(--board-danger-text)] focus:text-[var(--board-danger-text)] [&_svg]:!text-[var(--board-danger-text)]'
      )}
    >
      {e.icon}
      {e.label}
      {e.keys ? (
        <DropdownMenuShortcut>
          <ShortcutKeyCombo keys={e.keys} keyCapClassName={MENU_KEYCAP_CLASS} />
        </DropdownMenuShortcut>
      ) : null}
    </DropdownMenuItem>
  )

  return (
    <DropdownMenu modal={false} open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none absolute size-px"
          style={{ left: at.x, top: at.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={2}
        data-surface="board"
        className={cn(BOARD_MENU_CONTENT_CLASS, 'min-w-[222px]')}
      >
        {card.map(row)}
        <DropdownMenuSeparator className={BOARD_MENU_SEPARATOR_CLASS} />
        {create.map(row)}
        {row({
          action: 'memory',
          icon: <Brain />,
          label: translate('board.canvasMenu.memory', 'Insert memory')
        })}
        {row({
          action: 'skill',
          icon: <Sparkle />,
          label: translate('board.canvasMenu.skill', 'Insert skill')
        })}
        {row({
          action: 'branches',
          icon: <GitBranch />,
          label: translate('board.canvasMenu.gitBranches', 'Insert Git branches')
        })}
        {row({
          action: 'missionMap',
          icon: <Network />,
          label: translate('board.canvasMenu.missionMap', 'Mission Map')
        })}
        <DropdownMenuSeparator className={BOARD_MENU_SEPARATOR_CLASS} />
        {view.map(row)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
