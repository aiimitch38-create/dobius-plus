import React, { useRef, useState } from 'react'
import { Camera, ImagePlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useActiveWorktree } from '@/store/selectors'
import {
  APP_FEEDBACK_DETAILS_MAX,
  APP_FEEDBACK_TITLE_MAX,
  buildAppFeedbackTaskInput,
  type AppFeedbackKind
} from '../../../../../shared/app-feedback'
import {
  isVertexTaskAttachmentMime,
  VERTEX_TASK_ATTACHMENT_MAX_BYTES,
  VERTEX_TASK_ATTACHMENTS_MAX,
  type VertexTaskAttachmentMime
} from '../../../../../shared/vertex-task-types'
import { BOARD_FLOATING_PANEL_CLASS } from './board-surface-classes'

export type BoardReportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Hands off to the app-wide "Send Feedback" dialog (the Dobius team, not the Kanban). */
  onSendFeedbackInstead: () => void
}

/** An image waiting in the dialog; uploaded only after the card exists. */
type PendingImage = {
  key: string
  name: string
  mime: VertexTaskAttachmentMime
  bytes: number
  dataBase64: string
}

const FIELD_CLASS =
  'w-full rounded-[10px] border border-[var(--board-panel-border)] bg-[var(--board-panel-2)] px-3 py-2 text-[13px] text-[var(--board-text)] outline-none placeholder:text-[var(--board-text-muted)] focus-visible:border-[var(--board-accent)]'

const SMALL_BUTTON_CLASS =
  'flex h-8 items-center gap-1.5 rounded-[8px] border border-[var(--board-panel-border)] bg-[var(--board-panel-2)] px-2.5 text-xs font-medium text-[var(--board-text)] hover:border-[var(--board-accent)] disabled:opacity-50'

const MAX_MB = Math.round(VERTEX_TASK_ATTACHMENT_MAX_BYTES / (1024 * 1024))
// Why: Radix animates the close for 200ms; the shot must wait for the dialog
// and its overlay to be gone, not just unmounted in React.
const CAPTURE_HIDE_MS = 250

async function readAppVersion(): Promise<string> {
  try {
    return await window.api.updater.getVersion()
  } catch (err) {
    console.error('Failed to read app version for report:', err)
    return 'unknown'
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

let imageKeyCounter = 0

export function BoardReportDialog({
  open,
  onOpenChange,
  onSendFeedbackInstead
}: BoardReportDialogProps): React.JSX.Element {
  const [kind, setKind] = useState<AppFeedbackKind>('bug')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [images, setImages] = useState<PendingImage[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const mountedRef = useMountedRef()
  const titleRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeWorktree = useActiveWorktree()
  const studio = useAppStore((s) => s.boardStudio)

  const canSubmit = title.trim().length > 0 && !isSubmitting && !capturing

  const addFiles = async (files: Iterable<File>): Promise<void> => {
    const next: PendingImage[] = []
    let message: string | null = null
    for (const file of files) {
      if (images.length + next.length >= VERTEX_TASK_ATTACHMENTS_MAX) {
        message = translate('board.report.attachCountError', 'A card holds at most {{max}} images.', {
          max: VERTEX_TASK_ATTACHMENTS_MAX
        })
        break
      }
      if (!isVertexTaskAttachmentMime(file.type)) {
        message = translate(
          'board.report.attachTypeError',
          'Only PNG, JPG, WebP or GIF images can be attached.'
        )
        continue
      }
      if (file.size > VERTEX_TASK_ATTACHMENT_MAX_BYTES) {
        message = translate('board.report.attachSizeError', '{{name}} is larger than {{mb}} MB.', {
          name: file.name,
          mb: MAX_MB
        })
        continue
      }
      try {
        next.push({
          key: `img-${++imageKeyCounter}`,
          name: file.name || `image.${file.type.split('/')[1]}`,
          mime: file.type,
          bytes: file.size,
          dataBase64: await readFileAsBase64(file)
        })
      } catch (err) {
        console.error('Failed to read image:', err)
        message = translate(
          'board.report.attachTypeError',
          'Only PNG, JPG, WebP or GIF images can be attached.'
        )
      }
    }
    if (!mountedRef.current) {
      return
    }
    setImageError(message)
    if (next.length) {
      setImages((current) => [...current, ...next])
    }
  }

  const captureWindow = async (): Promise<void> => {
    if (images.length >= VERTEX_TASK_ATTACHMENTS_MAX) {
      setImageError(
        translate('board.report.attachCountError', 'A card holds at most {{max}} images.', {
          max: VERTEX_TASK_ATTACHMENTS_MAX
        })
      )
      return
    }
    setCapturing(true)
    setImageError(null)
    try {
      await new Promise((resolve) => setTimeout(resolve, CAPTURE_HIDE_MS))
      const dataBase64 = await window.api.vertexTasks.captureWindow()
      if (!mountedRef.current) {
        return
      }
      if (!dataBase64) {
        setImageError(
          translate('board.report.captureFailed', 'Could not capture the app window.')
        )
        return
      }
      if (Math.floor((dataBase64.length * 3) / 4) > VERTEX_TASK_ATTACHMENT_MAX_BYTES) {
        setImageError(
          translate('board.report.attachSizeError', '{{name}} is larger than {{mb}} MB.', {
            name: 'App window capture',
            mb: MAX_MB
          })
        )
        return
      }
      setImages((current) => [
        ...current,
        {
          key: `img-${++imageKeyCounter}`,
          name: `app-window-${current.length + 1}.png`,
          mime: 'image/png',
          bytes: Math.floor((dataBase64.length * 3) / 4),
          dataBase64
        }
      ])
    } catch (err) {
      console.error('Failed to capture app window:', err)
      if (mountedRef.current) {
        setImageError(
          translate('board.report.captureFailed', 'Could not capture the app window.')
        )
      }
    } finally {
      if (mountedRef.current) {
        setCapturing(false)
      }
    }
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit) {
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const appVersion = await readAppVersion()
      const input = buildAppFeedbackTaskInput({
        kind,
        title,
        details,
        context: {
          appVersion,
          view: studio ? `Board / ${studio}` : 'Board',
          worktreeName: activeWorktree?.displayName ?? null
        }
      })
      const created = await window.api.vertexTasks.create(input)
      if (!created) {
        throw new Error('vertexTasks.create returned null')
      }
      const { attached, failed } = await uploadImages(created.id, images)
      if (attached.length) {
        // Why: agents read the card body, so each file's absolute path goes
        // there as plain text; the record on the task is for the UI.
        const lines = attached.map((path) => `Screenshot: ${path}`).join('\n')
        const updated = await window.api.vertexTasks.update(created.id, {
          description: `${created.description}\n\n${lines}`
        })
        if (!updated) {
          console.warn('Report card created, but its screenshot paths could not be added to the description')
        }
      }
      if (!mountedRef.current) {
        return
      }
      toast.success(translate('board.report.added', 'Added to Kanban'), {
        action: {
          label: translate('board.report.openKanban', 'Open Kanban'),
          onClick: () => useAppStore.getState().setBoardStudio('kanban')
        }
      })
      if (failed > 0) {
        toast.warning(
          translate(
            'board.report.attachFailed',
            '{{failed}} of {{total}} images could not be attached. The card was still created.',
            { failed, total: images.length }
          )
        )
      }
      setTitle('')
      setDetails('')
      setImages([])
      setImageError(null)
      setKind('bug')
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to add report to Kanban:', err)
      if (mountedRef.current) {
        setError(
          translate('board.report.failed', 'Could not add this to the Kanban. Your text is kept.')
        )
      }
    } finally {
      if (mountedRef.current) {
        setIsSubmitting(false)
      }
    }
  }

  const kindOptions: { value: AppFeedbackKind; label: string }[] = [
    { value: 'bug', label: translate('board.report.kindBug', 'Bug') },
    { value: 'change', label: translate('board.report.kindChange', 'Change request') }
  ]

  return (
    <Dialog open={open && !capturing} onOpenChange={onOpenChange}>
      <DialogContent
        data-surface="board"
        className={cn(
          BOARD_FLOATING_PANEL_CLASS,
          'gap-4 rounded-[var(--board-radius-panel)] p-5 backdrop-blur-none sm:max-w-md dark:border-[var(--board-panel-border)] dark:bg-[var(--board-panel)] dark:shadow-(--board-shadow)'
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
        onPaste={(event) => {
          // Why: only the paste event's own payload is read; the system
          // clipboard is never polled.
          const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
            file.type.startsWith('image/')
          )
          if (files.length) {
            event.preventDefault()
            void addFiles(files)
          }
        }}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
            event.preventDefault()
          }
        }}
        onDrop={(event) => {
          const files = Array.from(event.dataTransfer?.files ?? [])
          if (files.length) {
            event.preventDefault()
            void addFiles(files)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-[15px] font-bold text-[var(--board-text)]">
            {translate('board.report.title', 'Report a bug or request a change')}
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--board-text-muted)]">
            {translate(
              'board.report.description',
              'This becomes a card on the Kanban for the Dobius lead to pick up.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div
          role="radiogroup"
          aria-label={translate('board.report.kindLabel', 'Type')}
          className="flex gap-1 rounded-[10px] bg-[var(--board-panel-2)] p-1"
        >
          {kindOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={kind === option.value}
              onClick={() => setKind(option.value)}
              className={cn(
                'flex-1 rounded-[8px] px-3 py-1.5 text-[13px] font-medium text-[var(--board-text-muted)]',
                kind === option.value &&
                  'bg-[var(--board-panel)] text-[var(--board-text)] shadow-(--board-shadow)'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--board-text)]">
          {translate('board.report.titleLabel', 'Title')}
          <input
            ref={titleRef}
            type="text"
            value={title}
            maxLength={APP_FEEDBACK_TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={translate('board.report.titlePlaceholder', 'One line: what happened?')}
            className={cn(FIELD_CLASS, 'h-9')}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--board-text)]">
          {translate('board.report.detailsLabel', 'Details (optional)')}
          <textarea
            value={details}
            maxLength={APP_FEEDBACK_DETAILS_MAX}
            onChange={(event) => setDetails(event.target.value)}
            rows={6}
            placeholder={translate(
              'board.report.detailsPlaceholder',
              'What were you doing, where in the app, and what did you expect instead?'
            )}
            className={cn(FIELD_CLASS, 'min-h-28 resize-y')}
          />
        </label>

        <div
          role="group"
          aria-label={translate('board.report.attachmentsLabel', 'Screenshots (optional)')}
          className="flex flex-col gap-2 text-xs font-medium text-[var(--board-text)]"
        >
          <span>{translate('board.report.attachmentsLabel', 'Screenshots (optional)')}</span>
          {images.length ? (
            <ul className="grid grid-cols-4 gap-2">
              {images.map((image) => (
                <li key={image.key} className="relative">
                  <img
                    src={`data:${image.mime};base64,${image.dataBase64}`}
                    alt={image.name}
                    title={image.name}
                    className="aspect-video w-full rounded-[8px] border border-[var(--board-panel-border)] object-cover object-top"
                  />
                  <button
                    type="button"
                    aria-label={translate('board.report.removeImage', 'Remove {{name}}', {
                      name: image.name
                    })}
                    onClick={() =>
                      setImages((current) => current.filter((item) => item.key !== image.key))
                    }
                    className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border border-[var(--board-panel-border)] bg-[var(--board-panel)] text-[var(--board-text-muted)] hover:text-[var(--board-text)]"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={SMALL_BUTTON_CLASS}
              disabled={isSubmitting || capturing}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="size-3.5" />
              {translate('board.report.addImage', 'Add image…')}
            </button>
            <button
              type="button"
              className={SMALL_BUTTON_CLASS}
              disabled={isSubmitting || capturing}
              onClick={() => void captureWindow()}
            >
              <Camera className="size-3.5" />
              {capturing
                ? translate('board.report.capturing', 'Capturing…')
                : translate('board.report.captureWindow', 'Capture app window')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                void addFiles(files)
              }}
            />
          </div>
          <p className="text-[11px] font-normal text-[var(--board-text-muted)]">
            {translate(
              'board.report.attachHint',
              'Paste, drop or add up to {{max}} images. PNG, JPG, WebP or GIF, {{mb}} MB each.',
              { max: VERTEX_TASK_ATTACHMENTS_MAX, mb: MAX_MB }
            )}
          </p>
          {imageError ? (
            <p role="alert" className="text-[11px] font-normal text-[var(--board-danger-text)]">
              {imageError}
            </p>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-xs text-[var(--board-danger-text)]">
            {error}
          </p>
        ) : null}

        <DialogFooter className="items-center sm:justify-between">
          <button
            type="button"
            onClick={onSendFeedbackInstead}
            className="text-xs text-[var(--board-text-muted)] underline-offset-2 hover:underline"
          >
            {translate('board.report.sendFeedbackInstead', 'Send feedback to the Dobius team instead')}
          </button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              {translate('board.report.cancel', 'Cancel')}
            </Button>
            <Button onClick={() => void submit()} disabled={!canSubmit}>
              {isSubmitting
                ? translate('board.report.adding', 'Adding…')
                : translate('board.report.submit', 'Add to Kanban')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Uploads one by one; a failure skips that image and the card stays. */
async function uploadImages(
  taskId: string,
  images: PendingImage[]
): Promise<{ attached: string[]; failed: number }> {
  const attached: string[] = []
  let failed = 0
  for (const image of images) {
    try {
      const record = await window.api.vertexTasks.addAttachment(taskId, {
        name: image.name,
        mime: image.mime,
        dataBase64: image.dataBase64
      })
      if (record) {
        attached.push(record.path)
      } else {
        failed += 1
      }
    } catch (err) {
      console.error('Failed to attach image:', err)
      failed += 1
    }
  }
  return { attached, failed }
}
