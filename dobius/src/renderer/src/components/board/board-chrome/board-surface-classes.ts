// Floating white panel look shared by every Board chrome piece and the command bar.
export const BOARD_FLOATING_PANEL_CLASS =
  'border border-[var(--board-panel-border)] bg-[var(--board-panel)] text-[var(--board-text)] shadow-(--board-shadow)'

export const BOARD_PILL_BUTTON_CLASS =
  'h-[30px] rounded-full px-3 text-[13px] font-semibold text-[var(--board-text)] hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)]'

export const BOARD_ICON_BUTTON_CLASS =
  'size-9 rounded-full text-[var(--board-text)] hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)]'

// URLs, paths and terminal-adjacent text on the Board (font loaded by BoardRoute).
export const BOARD_MONO_CLASS = "font-['JetBrains_Mono_Variable',ui-monospace,monospace]"

// Board menus (sym-card-context-menu.png): board panel in both themes (the shared
// menu sets its own dark: glass fill), 28px rows, 16px muted glyphs.
export const BOARD_MENU_CONTENT_CLASS = `${BOARD_FLOATING_PANEL_CLASS} rounded-[var(--board-radius-panel)] p-1.5 backdrop-blur-none dark:border-[var(--board-panel-border)] dark:bg-[var(--board-panel)] dark:text-[var(--board-text)] dark:shadow-(--board-shadow)`

export const BOARD_MENU_ROW_CLASS =
  'h-7 gap-2.5 rounded-[8px] px-2 text-[13px] text-[var(--board-text)] focus:bg-[var(--board-panel-2)] focus:text-[var(--board-text)] [&_svg]:size-4 [&_svg]:text-[var(--board-text-muted)]'

export const BOARD_MENU_SEPARATOR_CLASS = 'mx-1 my-1.5 bg-[var(--board-panel-border)]'
