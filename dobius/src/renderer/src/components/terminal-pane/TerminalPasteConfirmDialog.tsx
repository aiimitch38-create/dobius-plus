import React, { useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import {
  activeTerminalPasteConfirm,
  subscribeTerminalPasteConfirm,
  type TerminalPasteChoice
} from './terminal-paste-confirm-host'

export function TerminalPasteConfirmDialog(): React.JSX.Element {
  const request = useSyncExternalStore(subscribeTerminalPasteConfirm, activeTerminalPasteConfirm)
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const settle = (choice: TerminalPasteChoice): void => {
    request?.resolve(choice, dontAskAgain)
    setDontAskAgain(false)
  }
  const name =
    request?.targetName || translate('terminal.pasteConfirm.thisTerminal', 'this terminal')
  const title = request
    ? request.lineCount >= 2
      ? translate('terminal.pasteConfirm.titleLines', 'Paste {{count}} lines into {{name}}?', {
          count: request.lineCount,
          name
        })
      : translate('terminal.pasteConfirm.titleRisky', 'Paste this command into {{name}}?', {
          name
        })
    : ''
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && settle('cancel')}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {request && request.lineCount >= 2
              ? translate(
                  'terminal.pasteConfirm.mayRun',
                  'They may run as commands as soon as they land.'
                )
              : translate('terminal.pasteConfirm.mayRunOne', 'It may run as soon as it lands.')}
            {request?.risky
              ? ` ${translate('terminal.pasteConfirm.risky', 'It contains “{{command}}”.', {
                  command: request.risky
                })}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={dontAskAgain}
            onCheckedChange={(checked) => setDontAskAgain(checked === true)}
          />
          {translate('terminal.pasteConfirm.dontAsk', 'Don’t ask again (Settings › Terminal)')}
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => settle('cancel')}>
            {translate('terminal.pasteConfirm.cancel', 'Cancel')}
          </Button>
          {request && request.lineCount >= 2 ? (
            <Button type="button" variant="outline" onClick={() => settle('one-line')}>
              {translate('terminal.pasteConfirm.oneLine', 'Paste as one line')}
            </Button>
          ) : null}
          <Button type="button" onClick={() => settle('paste')}>
            {translate('terminal.pasteConfirm.paste', 'Paste')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
