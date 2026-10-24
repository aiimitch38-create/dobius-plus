// Why: tab strips should reveal as much title as space allows, then shrink to
// a readable floor before horizontal overflow takes over. 128px keeps an icon,
// "Terminal 12" and the close button legible; at 88px nine tabs all read
// "Termi…" (QA 2026-10-24) — the strip scrolls instead.
export const TAB_CONTAINER_WIDTH_CLASSES =
  'min-w-[128px] max-w-[280px] flex-[1_1_180px] min-[1280px]:flex-[1_1_220px]'

export const TAB_LABEL_WIDTH_CLASSES = 'min-w-0 flex-1 truncate'
