import React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { boardShortcutSheet } from '../board-chrome/board-shortcut-map'

type BoardShortcutSheetProps = { open: boolean; onOpenChange: (open: boolean) => void }

/** The "?" sheet: every Board shortcut, from the same maps the keys run on. */
export function BoardShortcutSheet({
  open,
  onOpenChange
}: BoardShortcutSheetProps): React.JSX.Element {
  const sections = boardShortcutSheet(navigator.userAgent.includes('Mac'))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-surface="board" className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{translate('board.shortcuts.title', 'Board shortcuts')}</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 grid-cols-1 gap-x-8 gap-y-5 overflow-y-auto pr-1 sm:grid-cols-2">
          {sections.map((section) => (
            <section key={section.title}>
              <h3 className="mb-2 text-[11px] font-semibold tracking-[0.06em] text-[var(--board-text-muted)] uppercase">
                {section.title}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {section.rows.map((row) => (
                  <li
                    key={row.label}
                    className="flex items-center justify-between gap-3 text-[13px] text-[var(--board-text)]"
                  >
                    <span className="min-w-0">{row.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((key) => (
                        <kbd
                          key={key}
                          className="inline-flex min-w-6 items-center justify-center rounded border border-[var(--board-panel-border)] bg-[var(--board-panel-2)] px-1.5 py-0.5 font-sans text-[11px] font-medium text-[var(--board-text-muted)]"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
