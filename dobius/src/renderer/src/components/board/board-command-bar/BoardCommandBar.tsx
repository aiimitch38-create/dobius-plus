import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { VoiceOrb } from '@/components/dictation/VoiceOrb'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  BOARD_FLOATING_PANEL_CLASS,
  BOARD_ICON_BUTTON_CLASS
} from '../board-chrome/board-surface-classes'
import { BoardChipRows } from './BoardChipRows'
import { BOARD_CHIP_ROWS, type BoardChipId } from './board-command-chips'
import {
  boardCommandHistory,
  stepBoardCommandHistory,
  type BoardCommandHistoryCursor
} from './board-command-history'
import { onCommandBarPrefill } from './board-command-prefill'
import { BoardThread, type BoardThreadMessage } from './BoardThread'

export type BoardCommandBarProps = {
  messages: readonly BoardThreadMessage[]
  projectName: string
  /** Dictation language shown in the thread header, e.g. "Auto". */
  languageLabel: string
  /** Controlled so hold-Space dictation (which types into the input) can submit it. */
  draft: string
  onDraftChange: (draft: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
  onCommand: (text: string) => void
  /** `anchor` is the clicked chip, so menus (agent picker) can open from it. */
  onChip: (id: BoardChipId, anchor: DOMRect) => void
  getVoiceLevel: () => number
  listening: boolean
  onMicToggle: () => void
  /** True while the planner is handling the last command; blocks double-submit. */
  busy?: boolean
}

export function BoardCommandBar({
  messages,
  projectName,
  languageLabel,
  draft,
  onDraftChange,
  inputRef,
  onCommand,
  onChip,
  getVoiceLevel,
  listening,
  onMicToggle,
  busy = false
}: BoardCommandBarProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(true)
  // A new message (reply, error, relay result) opens the thread so it is seen.
  const messageCount = messages.length
  useEffect(() => {
    if (messageCount > 0) {
      setCollapsed(false)
    }
  }, [messageCount])
  const isMac = navigator.userAgent.includes('Mac')
  const history = useMemo(() => boardCommandHistory(messages), [messages])
  const historyCursor = useRef<BoardCommandHistoryCursor>({ index: null, draft: '' })
  const onDraftChangeRef = useRef(onDraftChange)
  onDraftChangeRef.current = onDraftChange

  // Reply-to on a console or output viewer pre-fills "@Name " and hands over focus.
  useEffect(
    () =>
      onCommandBarPrefill((prefill) => {
        historyCursor.current = { index: null, draft: '' }
        onDraftChangeRef.current(prefill)
        requestAnimationFrame(() => {
          const input = inputRef.current
          input?.focus()
          input?.setSelectionRange(prefill.length, prefill.length)
        })
      }),
    [inputRef]
  )

  const recallHistory = (
    event: React.KeyboardEvent<HTMLInputElement>,
    direction: 'up' | 'down'
  ): void => {
    const input = event.currentTarget
    const browsing = historyCursor.current.index !== null
    // Up only recalls from the caret's start (or while already browsing), so
    // arrow keys keep their normal meaning mid-edit.
    if (
      direction === 'up' &&
      !browsing &&
      (input.selectionStart ?? 0) + (input.selectionEnd ?? 0) > 0
    ) {
      return
    }
    const step = stepBoardCommandHistory(history, historyCursor.current, direction, draft)
    if (step.text === null) {
      return
    }
    event.preventDefault()
    historyCursor.current = step.cursor
    onDraftChange(step.text)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = isMac ? event.metaKey : event.ctrlKey
      // Why: inside a terminal Mod+K is the terminal's own "clear" binding.
      const inTerminal =
        event.target instanceof Element && event.target.closest('[data-board-console], .xterm')
      if (
        mod &&
        !inTerminal &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inputRef, isMac])

  const text = draft.trim()
  const submit = (): void => {
    if (!text || busy) {
      return
    }
    onCommand(text)
    historyCursor.current = { index: null, draft: '' }
    onDraftChange('')
  }

  const collapseLabel = collapsed
    ? translate('board.commandBar.expand', 'Show thread')
    : translate('board.commandBar.collapse', 'Hide thread')
  const micLabel = listening
    ? translate('board.commandBar.stopListening', 'Stop listening')
    : translate('board.commandBar.startListening', 'Speak')

  return (
    // Collapsed (default, as in the reference): chip row 1 floats 14px above a
    // standalone composer. Expanded: thread + both chip rows join the composer panel.
    <div className="pointer-events-none absolute bottom-[28px] left-1/2 flex w-[min(560px,calc(100vw-176px))] -translate-x-1/2 flex-col items-center gap-[14px]">
      {collapsed ? (
        <div className="pointer-events-auto flex w-max max-w-[calc(100vw-176px)] flex-col items-center">
          <BoardChipRows rows={BOARD_CHIP_ROWS.slice(0, 1)} onChip={onChip} />
        </div>
      ) : null}
      <div
        className={cn(
          BOARD_FLOATING_PANEL_CLASS,
          // The dark reference lifts the composer to a lighter neutral than the rails.
          'pointer-events-auto flex w-full flex-col rounded-[20px] bg-[var(--board-composer)]'
        )}
      >
        {collapsed ? null : (
          <>
            <BoardThread
              messages={messages}
              projectName={projectName}
              languageLabel={languageLabel}
            />
            <div className="flex flex-col items-center gap-4 border-t border-[var(--board-panel-border)] px-[14px] pt-3 pb-[14px]">
              <BoardChipRows rows={BOARD_CHIP_ROWS} onChip={onChip} compact />
            </div>
          </>
        )}
        <form
          className="flex h-[60px] items-center gap-[18px] pr-3 pl-[19px]"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <VoiceOrb size={27} getLevel={getVoiceLevel} className="shrink-0" />
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              // Editing a recalled command makes it the new draft.
              historyCursor.current = { index: null, draft: '' }
              onDraftChange(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.currentTarget.blur()
              } else if (
                (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
                !event.nativeEvent.isComposing &&
                !event.shiftKey &&
                !event.altKey &&
                !event.metaKey &&
                !event.ctrlKey
              ) {
                recallHistory(event, event.key === 'ArrowUp' ? 'up' : 'down')
              }
            }}
            aria-label={translate('board.commandBar.inputLabel', 'Command')}
            placeholder={translate(
              'board.commandBar.placeholderAsk',
              'Hold space to speak · ask “what can you do?”'
            )}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--board-text)] outline-none placeholder:text-[var(--board-text-muted)]"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={collapseLabel}
                aria-expanded={!collapsed}
                className={cn(
                  BOARD_ICON_BUTTON_CLASS,
                  '-ml-3 size-[30px] border border-[var(--board-panel-border)]'
                )}
                onClick={() => setCollapsed((value) => !value)}
              >
                <ChevronDown className={cn('transition-transform', collapsed && 'rotate-180')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {collapseLabel}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="submit"
                size="icon"
                aria-label={translate('board.commandBar.send', 'Send')}
                disabled={!text || busy}
                className="ml-[-5px] size-[21px] rounded-full bg-[var(--board-accent)] [&_svg]:size-3 text-[var(--board-accent-fg)] hover:bg-[var(--board-accent)] disabled:bg-[var(--board-panel-2)] disabled:text-[var(--board-text-muted)] disabled:opacity-100"
              >
                <ArrowUp />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="flex items-center gap-2">
              {translate('board.commandBar.send', 'Send')}
              <ShortcutKeyCombo keys={['↵']} />
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={micLabel}
                aria-pressed={listening}
                className={cn(
                  BOARD_ICON_BUTTON_CLASS,
                  'size-[31px] bg-[var(--board-panel-2)]',
                  listening &&
                    'bg-[var(--board-accent)] text-[var(--board-accent-fg)] hover:bg-[var(--board-accent)] hover:text-[var(--board-accent-fg)]'
                )}
                onClick={onMicToggle}
              >
                <Mic />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {micLabel}
            </TooltipContent>
          </Tooltip>
        </form>
      </div>
    </div>
  )
}
