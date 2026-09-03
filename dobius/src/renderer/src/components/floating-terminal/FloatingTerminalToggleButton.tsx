import { useCallback, useLayoutEffect, useEffect, useRef, useState } from 'react'
import { MessageCircle, Mic, X } from 'lucide-react'
import { toast } from 'sonner'
import { FloatingTerminalIconContextMenu } from './FloatingTerminalIconContextMenu'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { useAppStore } from '@/store'
import { VoiceOrb } from '@/components/dictation/VoiceOrb'
import { dispatchDictationControl } from '@/components/dictation/dictation-control-events'
import { ensureAdamDockSession, findTerminalTabPtyId } from '@/lib/adam-dock-session'
import NativeChatView from '../native-chat/NativeChatView'
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

type FloatingTerminalDockMode = 'idle' | 'composing'

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

// ponytail: no live mic level feeds this dock's orb (that's the composer's
// own dictation meter, wired elsewhere) — a constant keeps the same VoiceOrb
// component's idle rotation/glow without duplicating a second orb look.
function getIdleOrbLevel(): number {
  return 0
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

  const [mode, setMode] = useState<FloatingTerminalDockMode>('idle')
  const [isHovered, setIsHovered] = useState(false)
  const [adamTabId, setAdamTabId] = useState<string | null>(null)
  const adamTabPtyId = useAppStore((state) =>
    adamTabId ? findTerminalTabPtyId(state, adamTabId) : null
  )

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
    if (mode === 'composing') {
      return
    }
    onToggle()
  }

  const openComposer = useCallback((): void => {
    setMode('composing')
    void ensureAdamDockSession().then((session) => {
      if (session) {
        setAdamTabId(session.tabId)
        return
      }
      toast.error(
        translate(
          'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-no-terminal',
          'Could not start a chat with ADAM.'
        )
      )
    })
  }, [])

  const closeComposer = useCallback((): void => {
    setMode('idle')
  }, [])

  // Why no onToggle() here: the composer is a self-contained chat UI — opening
  // it must never also show the floating terminal panel, or "chat" would look
  // like a terminal popping up alongside it (the thing this dock avoids).
  const handleChatButtonClick = useCallback((): void => {
    if (mode === 'composing') {
      closeComposer()
      return
    }
    openComposer()
  }, [mode, openComposer, closeComposer])

  // Why: the "E"/"C" hints only act as real shortcuts while the dock is
  // hovered and the composer isn't open — otherwise 'v'/'c' would hijack
  // normal typing (e.g. pasting with Cmd+V, or typing into the draft).
  useEffect(() => {
    if (!isHovered || mode === 'composing') {
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
  }, [isHovered, mode, handleChatButtonClick])

  const statusText =
    mode === 'composing'
      ? translate(
          'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-chatting',
          'Chatting with ADAM'
        )
      : translate('auto.components.floating.terminal.FloatingTerminalToggleButton.dock-ready', 'Ready')

  return (
    <FloatingTerminalIconContextMenu
      currentLocation="floating-button"
      className="fixed z-40"
      style={{ left: position.left, top: position.top }}
    >
      <div
        className={`max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border/60 bg-card text-card-foreground shadow-[0_4px_12px_rgb(0_0_0_/_0.22),0_0_0_1px_color-mix(in_srgb,var(--foreground)_12%,transparent)] transition-[width] duration-150 dark:shadow-[0_6px_16px_rgb(0_0_0_/_0.55),0_0_0_1px_rgb(255_255_255_/_0.22)] ${
          mode === 'composing' ? 'w-[26rem]' : 'w-80'
        }`}
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
            <VoiceOrb size={36} getLevel={getIdleOrbLevel} />
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
              onPointerDown={(event) => event.stopPropagation()}
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
              title={
                mode === 'composing'
                  ? translate(
                      'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-close-composer',
                      'Close chat'
                    )
                  : translate(
                      'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-chat-label',
                      'Chat'
                    )
              }
              aria-label={
                mode === 'composing'
                  ? translate(
                      'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-close-composer',
                      'Close chat'
                    )
                  : translate(
                      'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-chat-label',
                      'Chat'
                    )
              }
              className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                handleChatButtonClick()
              }}
            >
              {mode === 'composing' ? (
                <X className="size-3.5" />
              ) : (
                <MessageCircle className="size-3.5" />
              )}
              <span>
                {mode === 'composing'
                  ? translate(
                      'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-close-composer',
                      'Close'
                    )
                  : translate(
                      'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-chat-label',
                      'Chat'
                    )}
              </span>
              <span className={DOCK_KEY_BADGE_CLASS}>C</span>
            </button>
          </div>
        </div>

        {mode === 'composing' ? (
          <div className="h-[26rem] border-t border-border/60">
            {adamTabId ? (
              <NativeChatView terminalTabId={adamTabId} targetPtyId={adamTabPtyId} launchAgent="claude" />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {translate(
                  'auto.components.floating.terminal.FloatingTerminalToggleButton.dock-starting-adam',
                  'Starting ADAM…'
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </FloatingTerminalIconContextMenu>
  )
}
