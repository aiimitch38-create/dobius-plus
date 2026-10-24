import { MoreHorizontal } from 'lucide-react'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard, type BoardGroup } from '@/store/slices/board'
import { focusBoardGroup } from '../board-canvas/board-camera-focus'
import {
  deleteBoardGroupAndConsoles,
  groupAddress,
  planGroupDelete,
  ungroupBoardGroup
} from './group-lifecycle'

export function GroupFrameMenu({
  worktreeId,
  group
}: {
  worktreeId: string
  group: BoardGroup
}): React.JSX.Element {
  const confirm = useConfirmationDialog()
  const onDelete = async (): Promise<void> => {
    const count = planGroupDelete(getBoard(useAppStore.getState(), worktreeId), group.id).tabIds
      .length
    const ok = await confirm({
      title: translate('board.group.deleteTitle', 'Delete {{name}}?', { name: group.name }),
      description: translate(
        'board.group.deleteBody',
        'This closes {{count}} console(s) in the group and ends their agents. Notes and other cards stay.',
        { count }
      ),
      confirmLabel: translate('board.group.deleteConfirm', 'Delete group'),
      confirmVariant: 'destructive'
    })
    if (ok) {
      deleteBoardGroupAndConsoles(worktreeId, group.id)
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={translate('board.group.actions', '{{name}} actions', { name: group.name })}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex size-5 items-center justify-center rounded-full text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)]"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4}>
        <DropdownMenuLabel className="font-mono text-[11px] text-muted-foreground">
          {groupAddress(group.name)}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => focusBoardGroup(worktreeId, group.id)}>
          {translate('board.group.focus', 'Focus group')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => ungroupBoardGroup(worktreeId, group.id)}>
          {translate('board.group.ungroup', 'Ungroup')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void onDelete()}>
          {translate('board.group.delete', 'Delete group…')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
