import React, { useState } from 'react'
import { Check, Copy, Reply, Save } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { getConnectionId } from '@/lib/connection-context'
import { joinPath } from '@/lib/path'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import {
  createRuntimePath,
  runtimePathExists,
  writeRuntimeFile
} from '@/runtime/runtime-file-client'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { BOARD_MONO_CLASS } from '../board-chrome/board-surface-classes'
import { boardOutputRelativePath } from './board-output-filename'
import { boardReplyDraft, requestCommandBarPrefill } from './board-command-prefill'
import type { BoardThreadReport } from './BoardThread'

type BoardOutputViewerProps = {
  report: BoardThreadReport
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Save-to-outputs/ writes through the runtime-aware file client (SSH-aware) so
 * the saved report lands on the worktree's own host, not always-local disk.
 */
async function saveReportToOutputs(worktreeId: string, report: BoardThreadReport): Promise<string> {
  const state = useAppStore.getState()
  const worktreePath = findWorktreeById(state.worktreesByRepo, worktreeId)?.path
  if (!worktreePath) {
    throw new Error('Worktree path is not known yet')
  }
  const context = {
    settings: getSettingsForWorktreeRuntimeOwner(state, worktreeId),
    worktreeId,
    worktreePath,
    connectionId: getConnectionId(worktreeId) ?? undefined
  }
  const relativePath = boardOutputRelativePath(report.consoleTitle, new Date(report.at))
  const outputsDir = joinPath(worktreePath, 'outputs')
  if (!(await runtimePathExists(context, outputsDir))) {
    await createRuntimePath(context, outputsDir, 'directory')
  }
  const filePath = joinPath(worktreePath, relativePath)
  await writeRuntimeFile(context, filePath, report.full)
  return filePath
}

export function BoardOutputViewer({
  report,
  open,
  onOpenChange
}: BoardOutputViewerProps): React.JSX.Element {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)

  const onCopy = async (): Promise<void> => {
    try {
      await window.api.ui.writeClipboardText(report.full)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(translate('board.outputViewer.copyFailed', 'Could not copy.'))
    }
  }

  const onSave = async (): Promise<void> => {
    if (!worktreeId) {
      return
    }
    setSaving(true)
    try {
      const filePath = await saveReportToOutputs(worktreeId, report)
      toast.success(translate('board.outputViewer.saved', 'Saved to {{path}}', { path: filePath }))
    } catch (error) {
      toast.error(
        translate('board.outputViewer.saveFailed', 'Could not save: {{message}}', {
          message: error instanceof Error ? error.message : String(error)
        })
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-surface="board" className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">
            {report.agent} · {report.consoleTitle}
          </DialogTitle>
        </DialogHeader>
        <pre
          className={cn(
            BOARD_MONO_CLASS,
            'scrollbar-sleek min-h-0 flex-1 overflow-auto rounded-md border border-[var(--board-panel-border)] bg-[var(--board-panel-2)] p-3 text-[12px] leading-relaxed whitespace-pre-wrap'
          )}
        >
          {report.full}
        </pre>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onOpenChange(false)
              requestCommandBarPrefill(boardReplyDraft(report.consoleTitle))
            }}
          >
            <Reply className="size-3.5" />
            {translate('board.outputViewer.reply', 'Reply to {{name}}', {
              name: report.consoleTitle
            })}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void onCopy()}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {translate('board.outputViewer.copy', 'Copy')}
          </Button>
          <Button size="sm" disabled={saving || !worktreeId} onClick={() => void onSave()}>
            <Save className="size-3.5" />
            {translate('board.outputViewer.save', 'Save to outputs/')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
