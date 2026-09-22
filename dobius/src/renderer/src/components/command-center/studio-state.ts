import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'

export const panelKinds = ['note', 'brief', 'frame', 'image', 'resource'] as const
const panelSchema = z.object({
  id: z.string(),
  kind: z.enum(panelKinds),
  title: z.string(),
  text: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().min(240),
  height: z.number().min(180),
  image: z.string().optional(),
  resourceId: z.string().optional(),
  provider: z.enum(['ComfyUI', 'Viral Engine', 'Higgsfield']).default('ComfyUI'),
  variants: z.number().min(1).max(16).default(4),
  brightness: z.number().min(0).max(200).default(100),
  contrast: z.number().min(0).max(200).default(100)
})
const recordSchema = z.object({
  id: z.string(),
  kind: z.enum(['mission', 'client', 'campaign']),
  title: z.string(),
  notes: z.string(),
  status: z.enum(['Planned', 'In progress', 'Review', 'Done'])
})
const annotationSchema = z.object({
  id: z.string(),
  imageId: z.string(),
  text: z.string(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  status: z.enum(['Open', 'Resolved'])
})
export const studioSchema = z
  .object({
    version: z.literal(1),
    activeSpaceId: z.string(),
    spaces: z
      .array(z.object({ id: z.string(), name: z.string(), panels: z.array(panelSchema) }))
      .min(1),
    records: z.array(recordSchema),
    annotations: z.array(annotationSchema).default([])
  })
  .refine((data) => data.spaces.some((space) => space.id === data.activeSpaceId))
export type StudioData = z.infer<typeof studioSchema>
export type StudioPanel = z.infer<typeof panelSchema>
export type StudioRecord = z.infer<typeof recordSchema>
export type StudioAnnotation = z.infer<typeof annotationSchema>
export type StudioResource = { id: string; title: string; kind: string; worktreeId: string }
export type StudioAction =
  | 'terminal'
  | 'browser'
  | 'agents'
  | 'buzz'
  | 'automations'
  | 'skills'
  | 'system'

export function emptyStudio(): StudioData {
  return {
    version: 1,
    activeSpaceId: 'first-space',
    spaces: [{ id: 'first-space', name: 'My workspace', panels: [] }],
    records: [],
    annotations: []
  }
}

export function newPanel(kind: StudioPanel['kind'], index: number): StudioPanel {
  return {
    id: crypto.randomUUID(),
    kind,
    title: {
      note: 'Untitled note',
      brief: 'Generation brief',
      frame: 'Untitled frame',
      image: 'Reference image',
      resource: 'Workspace resource'
    }[kind],
    text: '',
    x: 80 + (index % 4) * 48,
    y: 80 + (index % 4) * 48,
    width: kind === 'frame' ? 560 : 360,
    height: kind === 'frame' ? 420 : 280,
    provider: 'ComfyUI',
    variants: 4,
    brightness: 100,
    contrast: 100
  }
}

function openStudioDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Assets live in IndexedDB so image imports cannot exhaust renderer localStorage.
    const request = indexedDB.open('dobius-creative-studio', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('workspaces')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () =>
      reject(new Error('Close other studio windows to finish opening storage.'))
  })
}

export function useStudioData(): {
  data: StudioData
  update: (change: (data: StudioData) => StudioData) => void
  ready: boolean
  saveState: string
  error: string | null
} {
  const [data, setData] = useState(emptyStudio)
  const latestData = useRef(data)
  const [ready, setReady] = useState(false)
  const [saveState, setSaveState] = useState('Opening workspace…')
  const [error, setError] = useState<string | null>(null)
  const database = useRef<IDBDatabase | null>(null)
  const revision = useRef(0)
  useEffect(() => {
    let cancelled = false
    void openStudioDatabase()
      .then((db) => {
        if (cancelled) {
          db.close()
          return
        }
        database.current = db
        const request = db.transaction('workspaces').objectStore('workspaces').get('studio')
        request.onsuccess = () => {
          if (cancelled) {
            return
          }
          const result = studioSchema.safeParse(request.result ?? emptyStudio())
          if (!result.success) {
            setError('Saved workspace could not be read. Its contents have been preserved.')
            return
          }
          latestData.current = result.data
          setData(result.data)
          setReady(true)
          setSaveState('Saved on this device')
        }
        request.onerror = () => setError('Could not read workspace storage. Reopen to retry.')
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(String(cause))
        }
      })
    return () => {
      cancelled = true
      database.current?.close()
      database.current = null
    }
  }, [])
  const update = (change: (current: StudioData) => StudioData): void => {
    if (!ready || !database.current) {
      return
    }
    const next = change(latestData.current)
    latestData.current = next
    setData(next)
    setSaveState('Saving…')
    setError(null)
    const currentRevision = ++revision.current
    try {
      // Transactions are ordered; an older save must never report a newer edit as saved.
      const transaction = database.current.transaction('workspaces', 'readwrite')
      transaction.objectStore('workspaces').put(next, 'studio')
      transaction.oncomplete = () => {
        if (revision.current === currentRevision) {
          setSaveState('Saved on this device')
        }
      }
      transaction.onerror = () => {
        setError('Changes could not be saved. Keep this window open and retry your edit.')
        setSaveState('Not saved')
      }
    } catch {
      setError('Workspace storage is unavailable. Changes are not saved.')
      setSaveState('Not saved')
    }
  }
  return { data, update, ready, saveState, error }
}
