import React, { useEffect, useRef, useState } from 'react'
import { Eraser, RotateCw, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { HelpMenuItems } from '@/components/sidebar/HelpMenuItems'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  BOARD_ICON_BUTTON_CLASS,
  BOARD_MENU_CONTENT_CLASS,
  BOARD_MENU_ROW_CLASS,
  BOARD_MENU_SEPARATOR_CLASS
} from './board-surface-classes'

// Why: a short open delay keeps the menu from popping while the pointer just
// passes over; the close delay lets it cross the gap from button to menu.
const HOVER_OPEN_MS = 120
const HOVER_CLOSE_MS = 200

type BoardAccountMenuProps = {
  avatarLabel: string
  onOpenAccounts: () => void
  onResetBoard: () => void
  onSendFeedback: () => void
}

export function BoardAccountMenu({
  avatarLabel,
  onOpenAccounts,
  onResetBoard,
  onSendFeedback
}: BoardAccountMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [showAdminOptions, setShowAdminOptions] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelHover = (): void => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }
  const scheduleOpen = (next: boolean, ms: number): void => {
    cancelHover()
    timer.current = setTimeout(() => setOpen(next), ms)
  }
  useEffect(() => cancelHover, [])

  const onHoverEnter = (event: React.PointerEvent): void => {
    // Touch and pen open on tap; only a mouse hover opens it.
    if (event.pointerType === 'mouse') {
      scheduleOpen(true, HOVER_OPEN_MS)
    }
  }
  const onHoverLeave = (event: React.PointerEvent): void => {
    if (event.pointerType === 'mouse') {
      scheduleOpen(false, HOVER_CLOSE_MS)
    }
  }

  const restart = (): void => {
    if (restarting) {
      return
    }
    setRestarting(true)
    toast.info(translate('board.account.restarting', 'Restarting Dobius+…'))
    void window.api.app.restart().catch((error) => {
      setRestarting(false)
      toast.error(translate('board.account.restartFailed', "Couldn't restart Dobius+."), {
        description: error instanceof Error ? error.message : undefined
      })
    })
  }

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        cancelHover()
        setOpen(next)
        if (!next) {
          setShowAdminOptions(false)
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={translate('board.topBar.accountMenu', 'Account and help')}
          className={cn(
            BOARD_ICON_BUTTON_CLASS,
            'size-8 bg-[var(--board-accent)] text-[14px] font-semibold text-[var(--board-accent-fg)] hover:bg-[var(--board-accent)] hover:text-[var(--board-accent-fg)]'
          )}
          onPointerEnter={onHoverEnter}
          onPointerLeave={onHoverLeave}
          onPointerDown={(event) => {
            // Why: same Option/Alt affordance as the sidebar Help menu for the admin rows.
            setShowAdminOptions(event.altKey)
            // Why: hover already opened it; a click must not toggle it shut again.
            if (open) {
              event.preventDefault()
            }
          }}
        >
          {avatarLabel.slice(0, 1).toUpperCase()}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-surface="board"
        align="end"
        sideOffset={8}
        className={cn(BOARD_MENU_CONTENT_CLASS, 'min-w-[220px]')}
        onPointerEnter={cancelHover}
        onPointerLeave={onHoverLeave}
      >
        <DropdownMenuItem className={BOARD_MENU_ROW_CLASS} onSelect={onOpenAccounts}>
          <UserRound />
          {translate('board.topBar.accounts', 'Accounts')}
        </DropdownMenuItem>
        <DropdownMenuItem className={BOARD_MENU_ROW_CLASS} disabled={restarting} onSelect={restart}>
          <RotateCw />
          {translate('board.account.restart', 'Restart Dobius+')}
        </DropdownMenuItem>
        <DropdownMenuItem
          className={cn(BOARD_MENU_ROW_CLASS, 'text-[var(--board-danger-text)]')}
          onSelect={onResetBoard}
        >
          <Eraser className="text-[var(--board-danger-text)]" />
          {translate('board.account.reset', 'Reset board')}
        </DropdownMenuItem>
        <DropdownMenuSeparator className={BOARD_MENU_SEPARATOR_CLASS} />
        <HelpMenuItems
          showAdminOptions={showAdminOptions}
          hideRestart
          onSendFeedback={onSendFeedback}
          itemClassName={BOARD_MENU_ROW_CLASS}
          separatorClassName={BOARD_MENU_SEPARATOR_CLASS}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
