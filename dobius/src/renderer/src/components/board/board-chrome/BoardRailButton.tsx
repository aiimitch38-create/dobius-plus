import React from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { cn } from '@/lib/utils'
import { BOARD_ICON_BUTTON_CLASS } from './board-surface-classes'

type BoardRailButtonProps = Omit<React.ComponentProps<typeof Button>, 'variant' | 'size'> & {
  label: string
  shortcut?: string
  active?: boolean
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

export function BoardRailButton({
  label,
  shortcut,
  active = false,
  tooltipSide = 'top',
  className,
  children,
  ...buttonProps
}: BoardRailButtonProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active || undefined}
          data-active={active || undefined}
          className={cn(
            BOARD_ICON_BUTTON_CLASS,
            active &&
              'bg-[var(--board-accent)] text-[var(--board-accent-fg)] hover:bg-[var(--board-accent)] hover:text-[var(--board-accent-fg)]',
            className
          )}
          {...buttonProps}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} sideOffset={6} className="flex items-center gap-2">
        {label}
        {shortcut ? <ShortcutKeyCombo keys={[shortcut]} /> : null}
      </TooltipContent>
    </Tooltip>
  )
}
