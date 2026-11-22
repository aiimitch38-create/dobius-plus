import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useModalReturnFocus } from '@/hooks/useModalReturnFocus'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { dismissWhatsNew, fetchPendingWhatsNew } from '@/lib/whats-new-api'
import { setWhatsNewOpen } from '@/lib/whats-new-open-state'
import type { WhatsNewPayload } from '../../../shared/whats-new'
import { BOARD_FLOATING_PANEL_CLASS } from './board/board-chrome/board-surface-classes'
import { WhatsNewNotesList } from './WhatsNewNotesList'

// Why a short wait: the window's tabs and panels restore first, so the popup
// does not appear over a half-drawn screen.
const READY_DELAY_MS = 2000
const WAIT_POLL_MS = 500

// Why: two keyboard-trapping surfaces fight over focus. Wait until any other
// open dialog or menu has closed, and until the window is the focused one.
function isClearToShow(): boolean {
  if (!document.hasFocus()) {
    return false
  }
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]'
    ) === null
  )
}

/**
 * The one-time "What's new" popup after an update. Main decides whether there
 * is anything to show (and remembers the last version shown); this only asks
 * once the window has settled, shows the notes, and reports Continue.
 */
export function WhatsNewDialog({ enabled }: { enabled: boolean }): React.JSX.Element | null {
  const [payload, setPayload] = useState<WhatsNewPayload | null>(null)
  const askedRef = useRef(false)
  const continueRef = useRef<HTMLButtonElement | null>(null)
  // Why: Radix keeps the content mounted while it animates closed; keep the
  // last notes so the text does not blank out mid-animation.
  const lastPayloadRef = useRef<WhatsNewPayload | null>(null)
  if (payload) {
    lastPayloadRef.current = payload
  }
  const displayed = payload ?? lastPayloadRef.current
  const open = payload !== null
  // Why: Radix's own close-time restore is suppressed below (it would land on
  // a stale element), so this puts focus back on the terminal, editor or
  // browser that had it before the popup opened.
  const { captureReturnFocus } = useModalReturnFocus(open)

  // Why: the terminal and global shortcut listeners run in the window capture
  // phase, before this popup sees a key; they check this flag and stand down.
  useEffect(() => {
    setWhatsNewOpen(open)
    return () => setWhatsNewOpen(false)
  }, [open])

  useEffect(() => {
    if (!enabled || askedRef.current) {
      return undefined
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const ask = (): void => {
      if (cancelled) {
        return
      }
      if (!isClearToShow()) {
        timer = setTimeout(ask, WAIT_POLL_MS)
        return
      }
      void fetchPendingWhatsNew()
        .then((pending) => {
          if (cancelled) {
            return
          }
          askedRef.current = true
          setPayload(pending)
        })
        .catch((error) => {
          console.warn('[whats-new] could not load the notes:', error)
        })
    }
    timer = setTimeout(ask, READY_DELAY_MS)
    return () => {
      cancelled = true
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }, [enabled])

  const close = useCallback(() => {
    setPayload(null)
    void dismissWhatsNew().catch((error) => {
      // The notes show once more next launch; nothing else is lost.
      console.warn('[whats-new] could not record the notes as read:', error)
    })
  }, [])

  if (!displayed) {
    return null
  }
  const newestVersion = displayed.sections[0].version

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        data-surface="board"
        data-testid="whats-new"
        showCloseButton={false}
        className={cn(
          BOARD_FLOATING_PANEL_CLASS,
          'gap-4 rounded-[var(--board-radius-panel)] p-5 backdrop-blur-none sm:max-w-md dark:border-[var(--board-panel-border)] dark:bg-[var(--board-panel)] dark:shadow-(--board-shadow)'
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          // Before focus moves into the popup, so the prior surface is known.
          captureReturnFocus()
          continueRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // Why: a stray click on the dimmed area must not mark the notes as read.
        onInteractOutside={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          // Why: keeps bubble-phase handlers behind the popup quiet. The
          // capture-phase ones check isWhatsNewOpen() themselves.
          event.stopPropagation()
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            close()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {translate('whatsNew.title', "What's new in Dobius+ {{version}}", {
              version: newestVersion
            })}
          </DialogTitle>
          <DialogDescription className="text-[var(--board-text-muted)]">
            {translate('whatsNew.description', 'Here is what changed since your last update.')}
          </DialogDescription>
        </DialogHeader>
        {/* Why min-h-0: a long list of skipped versions scrolls here instead
            of pushing Continue out of the box. */}
        <div className="scrollbar-sleek max-h-[min(60vh,420px)] min-h-0 overflow-y-auto pr-1">
          <WhatsNewNotesList
            sections={displayed.sections}
            showVersions={displayed.sections.length > 1}
            versionClassName="text-[var(--board-text-muted)]"
          />
        </div>
        <DialogFooter>
          <Button
            ref={continueRef}
            type="button"
            data-testid="whats-new-continue"
            onClick={close}
            className="bg-[var(--board-accent)] text-[var(--board-accent-fg)] hover:bg-[var(--board-accent)] hover:opacity-90"
          >
            {translate('whatsNew.continue', 'Continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
