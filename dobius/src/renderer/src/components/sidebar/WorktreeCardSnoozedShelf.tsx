import { useMemo, useState } from 'react'
import { ChevronRight, Clock } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { SnoozePicksSubmenu } from '@/components/tab-bar/SnoozePicksSubmenu'
import { useAppStore } from '@/store'
import { selectSnoozedTabsForWorktree } from '@/store/slices/tab-snooze'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { snoozeUntilLabel } from '@/lib/tab-snooze/snooze-pick-labels'
import {
  bringBackSnoozedTab,
  closeSnoozedTabForGood,
  resnoozeSnoozedTab,
  toggleSnoozedShelf
} from '@/lib/tab-snooze/snoozed-tab-actions'
import type { SnoozedTabEntry } from '../../../../shared/tab-snooze-types'

const NO_SNOOZED_TABS: SnoozedTabEntry[] = []

type RowMenu = { entry: SnoozedTabEntry; point: { x: number; y: number } }

/** Why: the shelf sits inside the worktree card, which selects and drags on these events. */
const stopCardEvent = (event: React.SyntheticEvent): void => event.stopPropagation()

/**
 * The folded "Snoozed" group under a worktree: tabs that were closed to come
 * back later. Renders nothing when the worktree has none.
 */
export default function WorktreeCardSnoozedShelf({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  // Why the fallbacks: the card renders against partial stores (web clients
  // before hydration, card tests), and a shelf with nothing to show must not
  // be what breaks it.
  const snoozedTabs = useAppStore((state) => state.snoozedTabs ?? NO_SNOOZED_TABS)
  const openTabs = useAppStore((state) => state.tabsByWorktree?.[worktreeId])
  const isOpen = useAppStore(
    (state) => state.snoozedShelfOpenWorktreeIds?.includes(worktreeId) ?? false
  )
  const [menu, setMenu] = useState<RowMenu | null>(null)
  const rows = useMemo(
    () =>
      selectSnoozedTabsForWorktree(
        { snoozedTabs, tabsByWorktree: { [worktreeId]: openTabs } },
        worktreeId
      ),
    [snoozedTabs, openTabs, worktreeId]
  )
  if (rows.length === 0) {
    return null
  }
  const openMenu = (entry: SnoozedTabEntry, event: React.MouseEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ entry, point: { x: event.clientX, y: event.clientY } })
  }
  const menuRef = menu ? { worktreeId: menu.entry.worktreeId, tabId: menu.entry.tabId } : null

  return (
    <div
      className="mt-1 min-w-0"
      data-snoozed-shelf={worktreeId}
      onClick={stopCardEvent}
      onPointerDown={stopCardEvent}
      onDoubleClick={stopCardEvent}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        className="flex w-full min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-worktree-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring"
        onClick={() => toggleSnoozedShelf(worktreeId)}
      >
        <ChevronRight
          className={cn('size-3 shrink-0 transition-transform', isOpen && 'rotate-90')}
        />
        <span className="truncate">
          {translate('components.sidebar.WorktreeCardSnoozedShelf.title', 'Snoozed')}
        </span>
        {/* Why data-surface: --board-accent is defined on the board surface only. */}
        <span
          data-surface="board"
          className="ml-auto shrink-0 text-[11px] tabular-nums"
          style={{ color: 'var(--board-accent)' }}
        >
          {rows.length}
        </span>
      </button>
      {isOpen ? (
        <ul className="mt-0.5 flex min-w-0 flex-col">
          {rows.map((entry) => (
            <li key={entry.tabId} className="min-w-0">
              <button
                type="button"
                data-snoozed-tab={entry.tabId}
                title={entry.preview ?? entry.customTitle ?? entry.title}
                className="flex w-full min-w-0 items-center gap-1.5 rounded-sm py-0.5 pr-1 pl-4 text-left text-[11px] text-muted-foreground hover:bg-worktree-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring"
                onClick={(event) => openMenu(entry, event)}
                onContextMenu={(event) => openMenu(entry, event)}
              >
                <span
                  data-surface={entry.ready ? 'board' : undefined}
                  className="inline-flex shrink-0"
                  style={entry.ready ? { color: 'var(--board-accent)' } : { color: 'inherit' }}
                >
                  <Clock className="size-3" />
                </span>
                <span className="min-w-0 flex-1 truncate">{entry.customTitle ?? entry.title}</span>
                <span className="shrink-0 text-muted-foreground/70">
                  {snoozeUntilLabel(entry.until)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <DropdownMenu
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMenu(null)
          }
        }}
        modal={false}
      >
        <DropdownMenuTrigger asChild>
          <button
            aria-hidden
            tabIndex={-1}
            className="pointer-events-none fixed size-px opacity-0"
            style={{ left: menu?.point.x ?? 0, top: menu?.point.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" sideOffset={0} align="start">
          <DropdownMenuItem onSelect={() => menuRef && void bringBackSnoozedTab(menuRef)}>
            {translate('components.sidebar.WorktreeCardSnoozedShelf.bringBack', 'Bring back now')}
          </DropdownMenuItem>
          <SnoozePicksSubmenu
            label={translate(
              'components.sidebar.WorktreeCardSnoozedShelf.snoozeUntil',
              'Snooze until'
            )}
            onPick={(until) => menuRef && void resnoozeSnoozedTab(menuRef, until)}
          />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => menuRef && void closeSnoozedTabForGood(menuRef)}
          >
            {translate(
              'components.sidebar.WorktreeCardSnoozedShelf.closeForGood',
              'Close for good'
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
