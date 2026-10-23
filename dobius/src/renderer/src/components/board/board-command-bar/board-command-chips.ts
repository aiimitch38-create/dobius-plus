export type BoardChipId =
  | 'new-console'
  | 'spawn-4'
  | 'group'
  | 'presets'
  | 'pause-all'
  | 'resume-all'
  | 'memory'
  | 'loops'
  | 'docs'
  | 'code'
  | 'skills'
  | 'mission-map'
  | 'kill-all'

// Two rows, matching the reference layout: agent control first, studios second.
export const BOARD_CHIP_ROWS: readonly (readonly BoardChipId[])[] = [
  ['new-console', 'spawn-4', 'group', 'presets', 'pause-all', 'resume-all', 'memory'],
  ['loops', 'docs', 'code', 'skills', 'mission-map', 'kill-all']
]

export const BOARD_DANGER_CHIPS: ReadonlySet<BoardChipId> = new Set(['kill-all'])
