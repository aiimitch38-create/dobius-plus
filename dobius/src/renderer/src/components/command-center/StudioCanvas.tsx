import { useRef, type PointerEvent } from 'react'
import {
  ArrowUpRight,
  Box,
  Frame,
  Grip,
  ImagePlus,
  Layers,
  StickyNote,
  Terminal,
  Globe,
  X
} from 'lucide-react'
import { Button } from '../ui/button'
import type { StudioAction, StudioPanel, StudioResource } from './studio-state'

type Props = {
  panels: StudioPanel[]
  selectedId: string | null
  zoom: number
  onSelect: (id: string | null) => void
  onChange: (id: string, patch: Partial<StudioPanel>) => void
  onRemove: (id: string) => void
  onAdd: (kind: StudioPanel['kind']) => void
  onAction: (action: StudioAction) => void
  onImport: () => void
  resources: StudioResource[]
  onResource: (resource: StudioResource) => void
}

function CanvasObject({ panel, props }: { panel: StudioPanel; props: Props }): React.JSX.Element {
  const element = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ x: number; y: number; resize: boolean } | null>(null)
  const current = useRef({ x: panel.x, y: panel.y, width: panel.width, height: panel.height })
  const begin = (event: PointerEvent<HTMLElement>, resize: boolean): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      return
    }
    props.onSelect(panel.id)
    gesture.current = { x: event.clientX, y: event.clientY, resize }
    current.current = { x: panel.x, y: panel.y, width: panel.width, height: panel.height }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const move = (event: PointerEvent<HTMLElement>): void => {
    const start = gesture.current
    if (!start || !element.current) {
      return
    }
    const dx = (event.clientX - start.x) / props.zoom
    const dy = (event.clientY - start.y) / props.zoom
    current.current = start.resize
      ? {
          x: panel.x,
          y: panel.y,
          width: Math.max(240, Math.min(1200, panel.width + dx)),
          height: Math.max(180, Math.min(1000, panel.height + dy))
        }
      : {
          x: Math.max(0, Math.min(2800 - panel.width, panel.x + dx)),
          y: Math.max(0, Math.min(2000 - panel.height, panel.y + dy)),
          width: panel.width,
          height: panel.height
        }
    Object.assign(element.current.style, {
      left: `${current.current.x}px`,
      top: `${current.current.y}px`,
      width: `${current.current.width}px`,
      height: `${current.current.height}px`
    })
  }
  const finish = (): void => {
    if (!gesture.current) {
      return
    }
    gesture.current = null
    props.onChange(panel.id, current.current)
  }
  const resource = props.resources.find((entry) => entry.id === panel.resourceId)
  return (
    <div
      ref={element}
      className={`studio-object ${panel.kind === 'frame' ? 'studio-frame' : ''}`}
      data-selected={props.selectedId === panel.id}
      style={{ left: panel.x, top: panel.y, width: panel.width, height: panel.height }}
      onPointerDown={() => props.onSelect(panel.id)}
    >
      <div
        className="studio-object-header"
        tabIndex={0}
        aria-label={`Move ${panel.title}`}
        onPointerDown={(event) => begin(event, false)}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={(event) => {
          const delta = {
            ArrowLeft: [-10, 0],
            ArrowRight: [10, 0],
            ArrowUp: [0, -10],
            ArrowDown: [0, 10]
          }[event.key]
          if (delta) {
            event.preventDefault()
            props.onChange(panel.id, {
              x: Math.max(0, Math.min(2800 - panel.width, panel.x + delta[0])),
              y: Math.max(0, Math.min(2000 - panel.height, panel.y + delta[1]))
            })
          }
        }}
      >
        <Grip className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{panel.title}</span>
        <button aria-label={`Remove ${panel.title}`} onClick={() => props.onRemove(panel.id)}>
          <X className="size-3.5" />
        </button>
      </div>
      <div className="studio-object-body scrollbar-sleek">
        {panel.kind === 'note' && (
          <textarea
            aria-label="Note text"
            placeholder="Capture an idea, a reference, or your next step…"
            value={panel.text}
            onChange={(event) => props.onChange(panel.id, { text: event.target.value })}
          />
        )}
        {panel.kind === 'brief' && (
          <>
            <div className="studio-caption">
              {panel.provider} · {panel.variants} variations · Draft
            </div>
            <textarea
              aria-label="Generation prompt"
              placeholder="Describe what you want to create…"
              value={panel.text}
              onChange={(event) => props.onChange(panel.id, { text: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Execution connector not wired. Your brief is saved for the next step.
            </p>
          </>
        )}
        {panel.kind === 'image' && panel.image && (
          <img
            src={panel.image}
            alt={panel.title}
            style={{ filter: `brightness(${panel.brightness}%) contrast(${panel.contrast}%)` }}
          />
        )}
        {panel.kind === 'frame' && (
          <p className="text-xs text-muted-foreground">
            {panel.text || 'Arrange related objects in this area.'}
          </p>
        )}
        {panel.kind === 'resource' && (
          <div className="space-y-4">
            <div className="studio-caption">Existing workspace resource</div>
            <p>{resource?.title ?? 'This session is no longer available.'}</p>
            <p className="text-xs text-muted-foreground">
              Open the original session in the workbench.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={!resource}
              onClick={() => resource && props.onResource(resource)}
            >
              Open session <ArrowUpRight />
            </Button>
          </div>
        )}
      </div>
      <div
        className="studio-resize"
        role="separator"
        aria-label={`Resize ${panel.title}`}
        aria-valuetext={`${panel.width} by ${panel.height}`}
        tabIndex={0}
        onPointerDown={(event) => begin(event, true)}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            return
          }
          event.preventDefault()
          props.onChange(panel.id, {
            width: Math.max(
              240,
              Math.min(
                1200,
                panel.width +
                  (event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0)
              )
            ),
            height: Math.max(
              180,
              Math.min(
                1000,
                panel.height + (event.key === 'ArrowDown' ? 10 : event.key === 'ArrowUp' ? -10 : 0)
              )
            )
          })
        }}
      >
        <Grip className="size-3" />
      </div>
    </div>
  )
}

export function StudioCanvas(props: Props): React.JSX.Element {
  return (
    <div className="studio-canvas-wrap">
      <div
        className="studio-canvas-scroll scrollbar-sleek"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            props.onSelect(null)
          }
        }}
      >
        {props.panels.length === 0 ? (
          <div className="studio-empty">
            <button
              className="studio-start studio-start-terminal"
              onClick={() => props.onAction('terminal')}
            >
              <Terminal />
              <span>
                <strong>Open a terminal</strong>
                <small>Continue in your workspace</small>
              </span>
              <ArrowUpRight />
            </button>
            <button
              className="studio-start studio-start-browser"
              onClick={() => props.onAction('browser')}
            >
              <Globe />
              <span>
                <strong>Add a live preview</strong>
                <small>Open the Dobius browser</small>
              </span>
              <ArrowUpRight />
            </button>
            <div className="studio-empty-title">
              <Box className="size-10" />
              <h1>Start with a blank canvas</h1>
              <p>Add an image, note, frame, or generation brief. Make room for your next idea.</p>
            </div>
            <button className="studio-start studio-start-image" onClick={props.onImport}>
              <ImagePlus />
              <span>
                <strong>Import a reference</strong>
                <small>Bring an image into your space</small>
              </span>
              <ArrowUpRight />
            </button>
            <button
              className="studio-start studio-start-frame"
              onClick={() => props.onAdd('frame')}
            >
              <Frame />
              <span>
                <strong>Create a new frame</strong>
                <small>Organize a direction or concept</small>
              </span>
              <ArrowUpRight />
            </button>
          </div>
        ) : (
          <div style={{ width: 2800 * props.zoom, height: 2000 * props.zoom }}>
            <div className="studio-plane" style={{ transform: `scale(${props.zoom})` }}>
              {[...props.panels]
                .sort((a, b) => Number(b.kind === 'frame') - Number(a.kind === 'frame'))
                .map((panel) => (
                  <CanvasObject key={panel.id} panel={panel} props={props} />
                ))}
            </div>
          </div>
        )}
      </div>
      <div className="studio-dock" aria-label="Canvas tools">
        <Button size="sm" onClick={() => props.onAdd('brief')}>
          <Layers />
          Generate
        </Button>
        <Button size="sm" variant="ghost" onClick={() => props.onAction('browser')}>
          <Globe />
          Browser
        </Button>
        <Button size="sm" variant="ghost" onClick={() => props.onAction('terminal')}>
          <Terminal />
          Terminal
        </Button>
        <Button size="sm" variant="ghost" onClick={props.onImport}>
          <ImagePlus />
          Image
        </Button>
        <Button size="sm" variant="ghost" onClick={() => props.onAdd('note')}>
          <StickyNote />
          Note
        </Button>
        <Button size="sm" variant="ghost" onClick={() => props.onAdd('frame')}>
          <Frame />
          Frame
        </Button>
      </div>
    </div>
  )
}
