import { useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

/* Why an app dialog: Electron does not implement window.prompt (it returns
 * null), so asking for the Done note with it made every such move snap back. */
export function KanbanDoneNoteDialog({
  open,
  onCancel,
  onConfirm
}: {
  open: boolean
  onCancel: () => void
  onConfirm: (resultNote: string) => void
}): React.JSX.Element {
  const [note, setNote] = useState('')
  const close = (): void => {
    setNote('')
    onCancel()
  }
  const confirm = (): void => {
    const resultNote = note.trim()
    if (!resultNote) {
      return
    }
    setNote('')
    onConfirm(resultNote)
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close()
        }
      }}
    >
      <DialogContent className="max-w-md border-kanban-border bg-kanban-panel text-kanban-foreground">
        <DialogHeader>
          <DialogTitle>Mark as done</DialogTitle>
          <DialogDescription>
            Done requires a short result note. What was completed?
          </DialogDescription>
        </DialogHeader>
        <label className="space-y-1.5 text-xs font-medium">
          <span>Result note</span>
          <textarea
            autoFocus
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What was completed?"
            rows={3}
            className="w-full resize-y rounded-lg border border-kanban-border bg-transparent p-3 text-[11px] leading-[1.55] outline-none placeholder:text-kanban-muted-foreground focus-visible:ring-2 focus-visible:ring-kanban-accent"
          />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!note.trim()}
            onClick={confirm}
            className="bg-kanban-accent text-kanban-accent-foreground hover:bg-kanban-accent-hover"
          >
            <Check />
            Mark done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
