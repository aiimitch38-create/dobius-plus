import { Clock } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { snoozeMenuPicks } from '@/lib/tab-snooze/snooze-pick-labels'

/** The Snooze time picks, shared by the tab menu and the Snoozed shelf's row menu. */
export function SnoozePicksSubmenu({
  label,
  disabled = false,
  onPick
}: {
  label: string
  disabled?: boolean
  onPick: (until: number | null) => void
}): React.JSX.Element {
  // Why read on every render: the menu mounts when it opens, so the times
  // ("Tonight 9:00 PM") are right for that moment.
  const picks = snoozeMenuPicks()
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>
        <Clock className="mr-1.5 size-3.5" />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        {picks.map((pick) => (
          <DropdownMenuItem key={pick.key} onSelect={() => onPick(pick.at)}>
            {pick.label}
            {pick.hint ? <DropdownMenuShortcut>{pick.hint}</DropdownMenuShortcut> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
