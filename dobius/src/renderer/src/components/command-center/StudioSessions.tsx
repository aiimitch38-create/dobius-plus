import type { Dispatch, SetStateAction } from 'react'
import { Box, Plus, Minus } from 'lucide-react'
import { Button } from '../ui/button'
import type { StudioPanel, StudioResource } from './studio-state'

export function StudioSessions({
  resources,
  add,
  zoom,
  setZoom
}: {
  resources: StudioResource[]
  add: (kind: StudioPanel['kind'], patch?: Partial<StudioPanel>) => void
  zoom: number
  setZoom: Dispatch<SetStateAction<number>>
}): React.JSX.Element {
  return (
    <>
      <div className="studio-section-title mt-6">Workspace sessions</div>
      {resources.length ? (
        resources.map((resource) => (
          <button
            key={resource.id}
            className="studio-space-row"
            onClick={() => add('resource', { title: resource.title, resourceId: resource.id })}
          >
            <Box className="size-4" />
            <span>{resource.title}</span>
            <Plus className="size-3" />
          </button>
        ))
      ) : (
        <p className="px-2 text-xs leading-relaxed text-muted-foreground">
          Open a workspace in Dobius to add references to its sessions.
        </p>
      )}
      <div className="studio-zoom">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => setZoom((value) => Math.max(0.4, value - 0.1))}
        >
          <Minus />
        </Button>
        <Button variant="ghost" size="sm" aria-label="Reset zoom" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={() => setZoom((value) => Math.min(1.6, value + 0.1))}
        >
          <Plus />
        </Button>
      </div>
    </>
  )
}
