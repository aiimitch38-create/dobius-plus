import { useCallback, useLayoutEffect, useEffect, useRef, useState } from 'react'
import { MessageCircle, Mic } from 'lucide-react'
import { toast } from 'sonner'
import { FloatingTerminalIconContextMenu } from './FloatingTerminalIconContextMenu'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { useAppStore } from '@/store'
import { VoiceOrb } from '@/components/dictation/VoiceOrb'
import { dispatchDictationControl } from '@/components/dictation/dictation-control-events'
import { voiceOrbLevelSource } from '@/components/dictation/voice-orb-live-level'
import { ensureFloatingTerminalAgentTab } from '@/lib/floating-terminal-agent-tab'
import {
  anchorFloatingTerminalTriggerPosition,
  clampFloatingTerminalTriggerPosition,
  getDefaultFloatingTerminalTriggerCommittedPosition,
  getDefaultFloatingTerminalTriggerPosition,
  persistFloatingTerminalTriggerPosition,
  readPersistedFloatingTerminalTriggerPosition,
  resolveFloatingTerminalTriggerCommittedPosition,
  resolveFloatingTerminalTriggerPosition,
  shouldReconcileFloatingTerminalTriggerPosition,
  type FloatingTerminalTriggerCommittedPosition,
  type FloatingTerminalTriggerPosition,
  type FloatingTerminalTriggerPositionSource
} from './floating-terminal-trigger-position'
import { translate } from '@/i18n/i18n'

const FLOATING_TERMINAL_TRIGGER_DRAG_THRESHOLD = 4
// ponytail: matches the reference dock's "E"/"C" key badges — reuse the same
// pill className for both instead of a one-off styled component.
const DOCK_KEY_BADGE_CLASS =
  'flex size-4 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-semibold leading-none'

type FloatingTerminalTriggerPositionState = {
  committedPosition: FloatingTerminalTriggerCommittedPosition
  position: FloatingTerminalTriggerPosition
  source: FloatingTerminalTriggerPositionSource
}

function readInitialTriggerPosition(): FloatingTerminalTriggerPositionState {
  const defaultCommittedPosition = getDefaultFloatingTerminalTriggerCommittedPosition()
  const defaultPosition = getDefaultFloatingTerminalTriggerPosition()
  if (typeof window === 'undefined') {
    return {
      committedPosition: defaultCommittedPosition,
      position: defaultPosition,
      source: 'default'
    }
  }
  const persistedPosition = readPersistedFloatingTerminalTriggerPosition()
  return persistedPosition
    ? {
        committedPosition: persistedPosition,
        position: shouldReconcileFloatingTerminalTriggerPosition('user')
          ? resolveFloatingTerminalTriggerPosition(persistedPosition, 'user')
          : resolveFloatingTerminalTriggerCommittedPosition(persistedPosition),
        source: 'user'
      }
    : {
        committedPosition: defaultCommittedPosition,
        position: defaultPosition,
        source: 'default'
      }
}

// Why a wrapper, not voiceOrbLevelSource.current directly: VoiceOrb re-reads
// whatever function identity it's given every frame, so a stable indirection
// here always calls whichever getLevel DictationIndicator most recently
// published — the orb moves exactly like it did when that component drew it.
function readSharedOrbLevel(): number {
  return voiceOrbLevelSource.current()
}

export function FloatingTerminalToggleButton({
  open,
  onToggle
}: {
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const shortcutLabel = useShortcutLabel('floatingTerminal.toggle')
  const initialPositionState = useRef<FloatingTerminalTriggerPositionState | null>(null)
  if (initialPositionState.current === null) {
    initialPositionState.current = readInitialTriggerPosition()
  }
  const positionSourceRef = useRef<FloatingTerminalTriggerPositionSource>(
    initialPositionState.current.source
  )
  const committedPositionRef = useRef<FloatingTerminalTriggerCommittedPosition>(
    initialPositionState.current.committedPosition
  )
  const [position, setPosition] = useState(initialPositionState.current.position)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    left: number
    top: number
    moved: boolean
  } | null>(null)
  const stagedPositionRef = useRef<FloatingTerminalTriggerPosition | null>(null)
  const suppressClickRef = useRef(false)

  const [isHovered, setIsHovered] = useState(false)
  const [isEnsuringChat, setIsEnsuringChat] = useState(false)
  const voiceCaption = useAppStore((state) => state.voiceOrbLabel)

  const previewPosition = useCallback((nextPosition: FloatingTerminalTriggerPosition): void => {
    const clamped = clampFloatingTerminalTriggerPosition(nextPosition)
    stagedPositionRef.current = clamped
    setPosition(clamped)
  }, [])

  const commitPosition = useCallback((nextPosition: FloatingTerminalTriggerPosition): void => {
    stagedPositionRef.current = null
    const clamped = clampFloatingTerminalTriggerPosition(nextPosition)
    setPosition(clamped)
    const anchoredPosition = anchorFloatingTerminalTriggerPosition(clamped)
    if (!anchoredPosition) {
      return
    }
    committedPositionRef.current = anchoredPosition
    positionSourceRef.current = 'user'
    persistFloatingTerminalTriggerPosition(anchoredPosition)
  }, [])

  const reconcilePosition = useCallback((): void => {
    setPosition((current) => {
      if (!shouldReconcileFloatingTerminalTriggerPosition(positionSourceRef.current)) {
        // Why: a startup-size viewport must not overwrite an intentional saved
        // drag position with the safety clamp before the renderer finishes sizing.
        return current
      }
      const next = resolveFloatingTerminalTriggerPosition(
        committedPositionRef.current,
        positionSourceRef.current
      )
      return next
    })
  }, [])

  useLayoutEffect(() => {
    // Why: Electron can mount before the renderer has final viewport dimensions;
    // default positions should re-anchor to bottom-right before first paint.
    reconcilePosition()
  }, [reconcilePosition])

  useEffect(() => {
    const handleResize = (): void => reconcilePosition()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [reconcilePosition])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: position.left,
      top: position.top,
      moved: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < FLOATING_TERMINAL_TRIGGER_DRAG_THRESHOLD) {
      return
    }
    drag.moved = true
    previewPosition({
      left: drag.left + dx,
      top: drag.top + dy
    })
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    suppressClickRef.current = drag.moved
    if (drag.moved && stagedPositionRef.current) {
      commitPosition(stagedPositionRef.current)
    }
    dragRef.current = null
  }

  const handleHeaderClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    onToggle()
  }

  // Why: the chat tab is real — it's part of the floating terminal workspace,
  // just forced into chat view. Bringing it to the front means opening the
  // same panel the header click opens, not a separate surface.
  const handleChatButtonClick = useCallback((): void => {
    setIsEnsuringChat(true)
    void ensureFloatingTerminalAgentTab()
      .then((tabId) => {
        if (!tabId) {
          toast.error(
            translate(
              'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-no-terminal',
              'Could not start the chat.'
            )
          )
          return
        }
        if (!open) {
          onToggle()
        }
      })
      .finally(() => setIsEnsuringChat(false))
  }, [open, onToggle])

  // Why: the "E"/"C" hints only act as real shortcuts while the dock is
  // hovered — otherwise 'e'/'c' would hijack normal typing elsewhere.
  useEffect(() => {
    if (!isHovered) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      const active = document.activeElement
      const isTyping =
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
      if (isTyping) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'e') {
        event.preventDefault()
        dispatchDictationControl('toggle')
      } else if (key === 'c') {
        event.preventDefault()
        handleChatButtonClick()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isHovered, handleChatButtonClick])

  const statusText =
    voiceCaption ??
    translate('auto.components.floating.terminal.FloatingTerminalToggleButton.dock-ready', 'Ready')

  return (
    <FloatingTerminalIconContextMenu
      currentLocation="floating-button"
      className="fixed z-40"
      style={{ left: position.left, top: position.top }}
    >
      <div className="relative w-80 max-w-[calc(100vw-2rem)]">
        {voiceCaption ? (
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-full border border-border/60 bg-popover px-2.5 py-1 text-xs font-medium whitespace-nowrap text-popover-foreground shadow-sm">
            {voiceCaption}
          </div>
        ) : null}
        <div
          className="overflow-hidden rounded-2xl border border-border/60 bg-card text-card-foreground shadow-[0_4px_12px_rgb(0_0_0_/_0.22),0_0_0_1px_color-mix(in_srgb,var(--foreground)_12%,transparent)] dark:shadow-[0_6px_16px_rgb(0_0_0_/_0.55),0_0_0_1px_rgb(255_255_255_/_0.22)]"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div
            data-floating-terminal-toggle
            title={translate(
              'auto.components.floating.terminal.FloatingTerminalToggleButton.bfe7809a70',
              '{{value0}} floating workspace ({{value1}})',
              { value0: open ? 'Minimize' : 'Show', value1: shortcutLabel }
            )}
            className="flex cursor-grab items-center gap-3 p-2 active:cursor-grabbing"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onClick={handleHeaderClick}
          >
            <button
              type="button"
              aria-label={translate(
                'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-talk',
                'Talk to Dobius'
              )}
              className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                // Why pressPtt, not openOrb: the app's one canonical voice orb
                // lives in DictationIndicator (mounted app-wide) and already
                // reacts to this same broadcast for ⌘T — opening the separate
                // floating-orb-window here would show a second, different orb.
                void window.api.jarvis.pressPtt()
              }}
            >
              <VoiceOrb size={36} getLevel={readSharedOrbLevel} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm leading-none font-medium">
                {translate(
                  'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-name',
                  'Dobius'
                )}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{statusText}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                title={translate(
                  'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-voice',
                  'Toggle dictation'
                )}
                aria-label={translate(
                  'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-voice',
                  'Toggle dictation'
                )}
                className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onPointerDown={(event) => {
                  // Why preventDefault: dictation inserts into whatever text
                  // field currently has focus (document.activeElement) at the
                  // instant it starts. A normal button click steals focus to
                  // itself first, so dictation had nowhere real to insert —
                  // this keeps focus on the field the user actually meant.
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  dispatchDictationControl('toggle')
                }}
              >
                <Mic className="size-3.5" />
                <span>
                  {translate(
                    'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-voice-label',
                    'Voice'
                  )}
                </span>
                <span className={DOCK_KEY_BADGE_CLASS}>E</span>
              </button>
              <button
                type="button"
                title={translate(
                  'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-chat-label',
                  'Chat'
                )}
                aria-label={translate(
                  'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-chat-label',
                  'Chat'
                )}
                disabled={isEnsuringChat}
                className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  handleChatButtonClick()
                }}
              >
                <MessageCircle className="size-3.5" />
                <span>
                  {translate(
                    'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-chat-label',
                    'Chat'
                  )}
                </span>
                <span className={DOCK_KEY_BADGE_CLASS}>C</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </FloatingTerminalIconContextMenu>
  )
}
