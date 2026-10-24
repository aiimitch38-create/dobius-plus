import React, { useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  DEFAULT_MIN_SIZE,
  RESIZE_HANDLES,
  handleCursor,
  resizeRect,
  screenDeltaToWorld,
  type MinSize,
  type Rect,
  type ResizeHandle
} from './card-geometry'
import {
  BOARD_MENU_CONTENT_CLASS,
  BOARD_MENU_ROW_CLASS,
  BOARD_MENU_SEPARATOR_CLASS
} from '../board-chrome/board-surface-classes'
import { translate } from '@/i18n/i18n'
import { passedCardDragThreshold, shouldStartCardDrag } from './card-drag-target'
import { focusMovedOutOfMenu } from './card-menu-focus'

export type BoardCardAction = {
  label: string
  onSelect: () => void
  destructive?: boolean
}

export type BoardCardFrameProps = {
  rect: Rect
  z: number
  zoom: number
  title: string
  /** Double-click the title to rename. */
  onRename?: (title: string) => void
  icon: React.ReactNode
  selected: boolean
  /** Extra title-bar controls rendered before the actions menu (status light, badge). */
  titleAccessory?: React.ReactNode
  actions?: BoardCardAction[]
  minSize?: MinSize
  /** Shapes, strokes and images render bare: no panel chrome, drag anywhere. */
  bare?: boolean
  onSelect: (additive: boolean) => void
  /** World-space delta; the parent applies it to the whole selection. */
  onDragBy: (dx: number, dy: number) => void
  onDragEnd?: () => void
  onResize: (rect: Rect) => void
  children: React.ReactNode
}

type DragState = {
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  /** False until the press passes the drag threshold (see passedCardDragThreshold). */
  moving: boolean
}
type ResizeState = {
  pointerId: number
  handle: ResizeHandle
  startX: number
  startY: number
  start: Rect
}

const HANDLE_POSITION: Record<ResizeHandle, string> = {
  n: 'left-2 right-2 top-0 -translate-y-1/2',
  s: 'left-2 right-2 bottom-0 translate-y-1/2',
  e: 'top-2 bottom-2 right-0 translate-x-1/2',
  w: 'top-2 bottom-2 left-0 -translate-x-1/2',
  ne: 'right-0 top-0 translate-x-1/2 -translate-y-1/2',
  nw: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2',
  se: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2',
  sw: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2'
}

// Edge handles are invisible hit strips; corner handles are visible squares.
function handleStyle(handle: ResizeHandle, px: (n: number) => number): React.CSSProperties {
  const cursor = handleCursor(handle)
  if (handle === 'n' || handle === 's') {
    return { cursor, height: px(10) }
  }
  if (handle === 'e' || handle === 'w') {
    return { cursor, width: px(10) }
  }
  return {
    cursor,
    width: px(10),
    height: px(10),
    background: 'var(--board-panel)',
    border: `${px(2)}px solid var(--board-accent)`,
    borderRadius: '50%'
  }
}

const NO_ACTIONS: BoardCardAction[] = []

const isAdditive = (e: React.PointerEvent): boolean => e.shiftKey || e.metaKey || e.ctrlKey

function EditableTitle({
  title,
  onRename,
  draft,
  setDraft
}: {
  title: string
  onRename?: (title: string) => void
  /** Owned by the frame so the "Rename" menu item can open the editor too. */
  draft: string | null
  setDraft: (draft: string | null) => void
}): React.JSX.Element {
  if (draft === null || !onRename) {
    return (
      <span
        className="min-w-0 flex-1 truncate text-[14px] font-semibold"
        onDoubleClick={onRename ? () => setDraft(title) : undefined}
      >
        {title}
      </span>
    )
  }
  const commit = (): void => {
    const next = draft.trim()
    setDraft(null)
    if (next && next !== title) {
      onRename(next)
    }
  }
  return (
    <input
      autoFocus
      data-board-card-control
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      aria-label={translate('board.card.rename', 'Rename')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit()
        } else if (e.key === 'Escape') {
          setDraft(null)
        }
      }}
      className="min-w-0 flex-1 rounded border border-[var(--board-panel-border)] bg-transparent px-1 text-[14px] font-semibold text-[var(--board-text)] outline-none"
    />
  )
}

export function BoardCardFrame({
  rect,
  z,
  zoom,
  title,
  onRename,
  icon,
  selected,
  titleAccessory,
  actions = NO_ACTIONS,
  minSize = DEFAULT_MIN_SIZE,
  bare = false,
  onSelect,
  onDragBy,
  onDragEnd,
  onResize,
  children
}: BoardCardFrameProps): React.JSX.Element {
  const dragRef = useRef<DragState | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  // Why: open the title editor only after the menu has closed and restored focus,
  // otherwise the closing menu pulls focus back and the editor blurs at once.
  const renamePending = useRef(false)
  const canRename = Boolean(onRename) && !bare
  const menuActions: BoardCardAction[] = canRename
    ? [
        {
          label: translate('board.card.rename', 'Rename'),
          onSelect: () => {
            renamePending.current = true
          }
        },
        ...actions
      ]
    : actions
  // Why: hit areas live in world space, so divide by zoom to keep handles and
  // the ring a constant on-screen size at any zoom level.
  const px = (n: number): number => n / (zoom > 0 ? zoom : 1)

  const startDrag = (e: React.PointerEvent<HTMLElement>): void => {
    if (!shouldStartCardDrag(e.button, e.target as Element, e.currentTarget)) {
      return
    }
    e.stopPropagation()
    onSelect(isAdditive(e))
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moving: false
    }
  }
  const moveDrag = (e: React.PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) {
      return
    }
    if (!drag.moving) {
      // The press ended somewhere we never heard about (no capture yet).
      if (e.buttons === 0) {
        dragRef.current = null
        return
      }
      if (!passedCardDragThreshold(e.clientX - drag.startX, e.clientY - drag.startY)) {
        return
      }
      drag.moving = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const { dx, dy } = screenDeltaToWorld(e.clientX - drag.lastX, e.clientY - drag.lastY, zoom)
    drag.lastX = e.clientX
    drag.lastY = e.clientY
    onDragBy(dx, dy)
  }
  const endDrag = (e: React.PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (drag?.pointerId === e.pointerId) {
      dragRef.current = null
      if (drag.moving) {
        onDragEnd?.()
      }
    }
  }

  const startResize = (handle: ResizeHandle) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return
    }
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeRef.current = {
      pointerId: e.pointerId,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      start: rect
    }
  }
  const moveResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    const r = resizeRef.current
    if (!r || r.pointerId !== e.pointerId) {
      return
    }
    const { dx, dy } = screenDeltaToWorld(e.clientX - r.startX, e.clientY - r.startY, zoom)
    onResize(resizeRect(r.start, r.handle, dx, dy, minSize))
  }
  const endResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (resizeRef.current?.pointerId === e.pointerId) {
      resizeRef.current = null
    }
  }

  const dragHandlers = {
    onPointerDown: startDrag,
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag
  }

  return (
    <div
      data-board-card
      className={cn(
        'group/board-card absolute flex flex-col',
        !bare &&
          'overflow-visible rounded-(--board-radius-card) border border-[var(--board-panel-border)] bg-[var(--board-panel)] text-[var(--board-text)] shadow-(--board-shadow)'
      )}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex: z,
        outline: selected ? `${px(2)}px solid var(--board-accent)` : undefined,
        // Reference: the selection line sits on the card edge, covering the 1px border.
        outlineOffset: selected ? -px(1) : undefined
      }}
      // Why: clicks inside the body select the card but must not start a canvas pan.
      onPointerDown={(e) => {
        if (e.button === 0) {
          e.stopPropagation()
          if (!bare) {
            onSelect(isAdditive(e))
          }
        }
      }}
      {...(bare ? dragHandlers : {})}
    >
      {!bare && (
        <div
          className="flex h-10 shrink-0 cursor-grab items-center gap-2 border-b border-[var(--board-panel-border)] px-3 select-none active:cursor-grabbing"
          {...dragHandlers}
        >
          <span className="flex size-4 shrink-0 items-center justify-center text-[var(--board-text-muted)] [&_svg]:size-4">
            {icon}
          </span>
          <EditableTitle
            title={title}
            onRename={onRename}
            draft={titleDraft}
            setDraft={setTitleDraft}
          />
          {titleAccessory}
          {menuActions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-board-card-control
                  aria-label={translate('board.card.actions', '{{title}} actions', { title })}
                  className="flex size-7 items-center justify-center rounded-full text-[var(--board-text-muted)] opacity-0 transition-opacity group-hover/board-card:opacity-100 hover:bg-[var(--board-panel-2)] focus-visible:opacity-100 data-[state=open]:opacity-100"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                side="bottom"
                sideOffset={4}
                data-surface="board"
                className={BOARD_MENU_CONTENT_CLASS}
                onCloseAutoFocus={(e) => {
                  if (renamePending.current) {
                    renamePending.current = false
                    e.preventDefault()
                    setTitleDraft(title)
                    return
                  }
                  if (
                    focusMovedOutOfMenu(
                      document.activeElement,
                      document.body,
                      e.target as Element | null
                    )
                  ) {
                    e.preventDefault()
                  }
                }}
              >
                {menuActions.map((action, i) => (
                  <React.Fragment key={action.label}>
                    {action.destructive && i > 0 && (
                      <DropdownMenuSeparator className={BOARD_MENU_SEPARATOR_CLASS} />
                    )}
                    <DropdownMenuItem
                      variant={action.destructive ? 'destructive' : 'default'}
                      onSelect={action.onSelect}
                      className={cn(
                        BOARD_MENU_ROW_CLASS,
                        action.destructive &&
                          'text-[var(--board-danger-text)] focus:text-[var(--board-danger-text)]'
                      )}
                    >
                      {action.label}
                    </DropdownMenuItem>
                  </React.Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      <div
        data-board-wheel="native"
        className={cn(
          'relative min-h-0 flex-1',
          !bare && 'overflow-hidden rounded-b-(--board-radius-card)'
        )}
      >
        {children}
      </div>
      {selected &&
        RESIZE_HANDLES.map((handle) => (
          <div
            key={handle}
            aria-hidden
            className={cn('absolute', HANDLE_POSITION[handle])}
            style={handleStyle(handle, px)}
            onPointerDown={startResize(handle)}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
        ))}
    </div>
  )
}
