import { ChevronDown, Folder, LayoutTemplate } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  BOARD_FLOATING_PANEL_CLASS,
  BOARD_MENU_CONTENT_CLASS,
  BOARD_MENU_ROW_CLASS,
  BOARD_MENU_SEPARATOR_CLASS,
  BOARD_PILL_BUTTON_CLASS
} from '../board-chrome/board-surface-classes'
import type { BoardPreset } from '../board-presets/board-preset'
import type { PresetDefinition } from '../board-presets/preset-catalog'
import type { HomePresetChoice } from './home-open'
import type { HomeRepoRow } from './home-repo-rows'

const LABEL_CLASS = 'px-2 pt-1.5 pb-1 text-[11px] font-semibold text-[var(--board-text-muted)]'

function presetLabel(choice: HomePresetChoice, catalog: readonly PresetDefinition[]): string {
  if (!choice) {
    return translate('board.home.noPreset', 'No preset')
  }
  if (choice.kind === 'user') {
    return choice.preset.name
  }
  return (
    catalog.find((p) => p.id === choice.id)?.name ?? translate('board.home.noPreset', 'No preset')
  )
}

export function HomeLauncherBar({
  rows,
  selected,
  onSelectRepo,
  catalog,
  userPresets,
  preset,
  onSelectPreset,
  opening,
  onOpen
}: {
  rows: readonly HomeRepoRow[]
  selected: HomeRepoRow | null
  onSelectRepo: (repoId: string) => void
  catalog: readonly PresetDefinition[]
  userPresets: readonly BoardPreset[]
  preset: HomePresetChoice
  onSelectPreset: (choice: HomePresetChoice) => void
  opening: boolean
  onOpen: () => void
}): React.JSX.Element {
  const trigger = cn(BOARD_PILL_BUTTON_CLASS, 'h-9 min-w-0 gap-2 px-3')
  const primaryLabel = selected?.hasBoardSession
    ? translate('board.home.resume', 'Resume')
    : translate('board.home.openBoard', 'Open board')

  return (
    <div
      className={cn(
        BOARD_FLOATING_PANEL_CLASS,
        'flex h-[52px] w-full items-center gap-1 rounded-full py-2 pr-2 pl-2'
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className={cn(trigger, 'max-w-[45%]')}
            disabled={rows.length === 0}
          >
            <Folder className="text-[var(--board-text-muted)]" />
            <span className="truncate">
              {selected?.name ?? translate('board.home.noRepos', 'No repos yet')}
            </span>
            <ChevronDown className="size-3.5 text-[var(--board-text-muted)]" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-surface="board"
          align="start"
          sideOffset={8}
          className={cn(BOARD_MENU_CONTENT_CLASS, 'max-h-[320px] min-w-[220px] overflow-y-auto')}
        >
          {rows.map((row) => (
            <DropdownMenuItem
              key={row.repoId}
              className={BOARD_MENU_ROW_CLASS}
              onSelect={() => onSelectRepo(row.repoId)}
            >
              <Folder />
              <span className="truncate">{row.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="h-5 w-px shrink-0 bg-[var(--board-panel-border)]" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className={cn(trigger, 'max-w-[40%]')}>
            <LayoutTemplate className="text-[var(--board-text-muted)]" />
            <span
              className={cn('truncate', !preset && 'font-medium text-[var(--board-text-muted)]')}
            >
              {presetLabel(preset, catalog)}
            </span>
            <ChevronDown className="size-3.5 text-[var(--board-text-muted)]" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-surface="board"
          align="start"
          sideOffset={8}
          className={cn(BOARD_MENU_CONTENT_CLASS, 'max-h-[360px] min-w-[240px] overflow-y-auto')}
        >
          <DropdownMenuItem className={BOARD_MENU_ROW_CLASS} onSelect={() => onSelectPreset(null)}>
            {translate('board.home.noPreset', 'No preset')}
          </DropdownMenuItem>
          <DropdownMenuSeparator className={BOARD_MENU_SEPARATOR_CLASS} />
          <DropdownMenuLabel className={LABEL_CLASS}>
            {translate('board.home.presetsCatalog', 'Presets')}
          </DropdownMenuLabel>
          {catalog.map((p) => (
            <DropdownMenuItem
              key={p.id}
              className={BOARD_MENU_ROW_CLASS}
              onSelect={() => onSelectPreset({ kind: 'catalog', id: p.id })}
            >
              <span className="truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
          {userPresets.length > 0 ? (
            <>
              <DropdownMenuSeparator className={BOARD_MENU_SEPARATOR_CLASS} />
              <DropdownMenuLabel className={LABEL_CLASS}>
                {translate('board.home.presetsSaved', 'Saved boards')}
              </DropdownMenuLabel>
              {userPresets.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  className={BOARD_MENU_ROW_CLASS}
                  onSelect={() => onSelectPreset({ kind: 'user', preset: p })}
                >
                  <span className="truncate">{p.name}</span>
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex-1" />
      <Button
        onClick={onOpen}
        disabled={!selected || opening}
        className="h-9 w-[132px] shrink-0 rounded-full bg-[var(--board-accent)] text-[13px] font-semibold text-[var(--board-accent-fg)] hover:bg-[var(--board-accent)] hover:brightness-110"
      >
        {primaryLabel}
      </Button>
    </div>
  )
}
