import { useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import type { VertexTaskAttachment } from '../../../../shared/vertex-task-types'

/** Thumbnail of a card attachment; clicking opens the file in the OS viewer. */
export function KanbanAttachmentThumb({
  taskId,
  attachment
}: {
  taskId: string
  attachment: VertexTaskAttachment
}): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const api = window.api?.vertexTasks
    if (!api?.readAttachment) {
      setFailed(true)
      return
    }
    api
      .readAttachment(taskId, attachment.id)
      .then((url) => {
        if (!cancelled) {
          if (url) {
            setSrc(url)
          } else {
            setFailed(true)
          }
        }
      })
      .catch((err: unknown) => {
        console.error('Failed to read attachment:', err)
        if (!cancelled) {
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [taskId, attachment.id])

  const open = (): void => {
    window.api?.shell?.openFilePath(attachment.path).catch((err: unknown) => {
      console.error('Failed to open attachment:', err)
    })
  }

  return (
    <button
      type="button"
      onClick={open}
      title={attachment.name}
      aria-label={`Open ${attachment.name}`}
      className="grid aspect-video min-w-0 place-items-center overflow-hidden rounded-md border border-kanban-border bg-kanban-column outline-none focus-visible:ring-2 focus-visible:ring-kanban-accent"
    >
      {src ? (
        <img src={src} alt={attachment.name} className="size-full object-cover object-top" />
      ) : (
        <ImageOff
          className={failed ? 'size-4 text-kanban-muted-foreground' : 'size-4 animate-pulse text-kanban-muted-foreground'}
        />
      )}
    </button>
  )
}
