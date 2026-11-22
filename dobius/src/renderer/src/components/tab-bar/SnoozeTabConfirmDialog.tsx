import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { snoozeTerminalTab } from '@/lib/tab-snooze/snooze-terminal-tab'

/** Asks before snoozing a tab whose agent is in the middle of a turn. */
export default function SnoozeTabConfirmDialog(): React.JSX.Element {
  const request = useAppStore((state) => state.snoozeTabConfirm)
  const setSnoozeTabConfirm = useAppStore((state) => state.setSnoozeTabConfirm)
  const tabLabel = request?.tabLabel.trim()

  const handleConfirm = (): void => {
    if (!request) {
      return
    }
    setSnoozeTabConfirm(null)
    void snoozeTerminalTab(request.tabId, request.until, { confirmed: true })
  }

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setSnoozeTabConfirm(null)
        }
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate(
              'components.tab.bar.SnoozeTabConfirmDialog.title',
              'Snooze a tab that is still working?'
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {request?.resumes === false
              ? translate(
                  'components.tab.bar.SnoozeTabConfirmDialog.stops',
                  'Snoozing stops it now. What it was doing will not carry on when the tab comes back.'
                )
              : translate(
                  'components.tab.bar.SnoozeTabConfirmDialog.resumes',
                  'Snoozing stops it now. The conversation picks up where it left off when the tab comes back.'
                )}
          </DialogDescription>
        </DialogHeader>
        {tabLabel ? (
          <p className="truncate text-xs font-medium text-foreground" title={tabLabel}>
            {tabLabel}
          </p>
        ) : null}
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSnoozeTabConfirm(null)}
          >
            {translate('components.tab.bar.SnoozeTabConfirmDialog.cancel', 'Cancel')}
          </Button>
          <Button type="button" size="sm" autoFocus onClick={handleConfirm}>
            {translate('components.tab.bar.SnoozeTabConfirmDialog.confirm', 'Snooze')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
