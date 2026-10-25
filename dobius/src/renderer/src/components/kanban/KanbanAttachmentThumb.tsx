import { useEffect, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VertexTaskAttachment } from '../../../../shared/vertex-task-types'

// Why: the same attachment is drawn on the card and in the detail panel, and
// the board re-renders on every poll; one read per attachment id is enough.
// Bounded LRU (Map keeps insertion order) so a long board cannot pin every
// data URL in memory.
const CACHE_MAX = 24
const dataUrlCache = new Map<string, Promise<string | null>>()

function readAttachmentCached(taskId: string, attachmentId: string): Promise<string | null> {
  const cached = dataUrlCache.get(attachmentId)
  if (cached) {
    dataUrlCache.delete(attachmentId)
    dataUrlCache.set(attachmentId, cached)
    return cached
  }
  const api = window.api?.vertexTasks
  if (!api?.readAttachment) {
    return Promise.resolve(null)
  }
  const pending = api.readAttachment(taskId, attachmentId).then((url) => {
    if (!url) {
      dataUrlCache.delete(attachmentId)
    }
    return url
  })
  if (dataUrlCache.size >= CACHE_MAX) {
    const oldest = dataUrlCache.keys().next().value
    if (oldest !== undefined) {
      dataUrlCache.delete(oldest)
    }
  }
  dataUrlCache.set(attachmentId, pending)
  return pending
}

/** Thumbnail of a card attachment; clicking opens the file in the OS viewer.
 *  The bytes are only requested once the element is on screen. */
export function KanbanAttachmentThumb({
  taskId,
  attachment,
  className,
  title,
  onClick
}: {
  taskId: string
  attachment: VertexTaskAttachment
  className?: string
  title?: string
  /** Replaces the default "open in the OS viewer" click. */
  onClick?: () => void
}): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const node = ref.current
    if (visible || !node) {
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) {
      return
    }
    let cancelled = false
    readAttachmentCached(taskId, attachment.id)
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
  }, [taskId, attachment.id, visible])

  const open = (): void => {
    window.api?.shell?.openFilePath(attachment.path).catch((err: unknown) => {
      console.error('Failed to open attachment:', err)
    })
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick ?? open}
      title={title ?? attachment.name}
      aria-label={`Open ${attachment.name}`}
      className={cn(
        'grid aspect-video min-w-0 place-items-center overflow-hidden rounded-md border border-kanban-border bg-kanban-column outline-none focus-visible:ring-2 focus-visible:ring-kanban-accent',
        className
      )}
    >
      {src ? (
        <img src={src} alt={attachment.name} className="size-full object-cover object-top" />
      ) : (
        <ImageOff
          className={
            failed
              ? 'size-4 text-kanban-muted-foreground'
              : 'size-4 animate-pulse text-kanban-muted-foreground'
          }
        />
      )}
    </button>
  )
}

/** The attachment a Review/Done card should show: the newest proof, else the
 *  newest screenshot; null when the card has none. */
export function pickProofAttachment(
  attachments: VertexTaskAttachment[] | undefined
): VertexTaskAttachment | null {
  if (!attachments?.length) {
    return null
  }
  const newestFirst = [...attachments].sort((a, b) => b.createdAt - a.createdAt)
  return newestFirst.find((attachment) => attachment.kind === 'proof') ?? newestFirst[0] ?? null
}
