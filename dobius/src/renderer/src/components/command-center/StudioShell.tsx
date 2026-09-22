import { useRef, useState } from 'react'
import {
  ArrowUpRight,
  Box,
  Check,
  Folder,
  ImagePlus,
  Layers,
  Plus,
  Search,
  StickyNote
} from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { StudioCanvas } from './StudioCanvas'
import { StudioInspector } from './StudioInspector'
import { StudioRecords } from './StudioRecords'
import { StudioOverview } from './StudioOverview'
import {
  newPanel,
  useStudioData,
  type StudioAction,
  type StudioPanel,
  type StudioResource
} from './studio-state'
import './studio.css'
import './studio-review.css'
import { StudioReview } from './StudioReview'
import { StudioSessions } from './StudioSessions'
import { readStudioImage } from './studio-image-import'
import { MiniPaintEditor } from './MiniPaintEditor'
import { surfaces, type Surface } from './studio-surfaces'

export function StudioShell({
  resources,
  onResource,
  onAction,
  preview = false
}: {
  resources: StudioResource[]
  onResource: (resource: StudioResource) => void
  onAction: (action: StudioAction) => void
  preview?: boolean
}): React.JSX.Element {
  const { data, update, ready, saveState, error } = useStudioData()
  const [surface, setSurface] = useState<Surface>('canvas')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [spaceName, setSpaceName] = useState('')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const activeSpace = data.spaces.find((space) => space.id === data.activeSpaceId) ?? data.spaces[0]
  const selected = activeSpace.panels.find((panel) => panel.id === selectedId)
  const updatePanels = (change: (panels: StudioPanel[]) => StudioPanel[]): void =>
    update((current) => ({
      ...current,
      spaces: current.spaces.map((space) =>
        space.id === current.activeSpaceId ? { ...space, panels: change(space.panels) } : space
      )
    }))
  const add = (kind: StudioPanel['kind'], patch: Partial<StudioPanel> = {}): void => {
    const panel = { ...newPanel(kind, activeSpace.panels.length), ...patch }
    updatePanels((panels) => [...panels, panel])
    setSelectedId(panel.id)
    setSurface('canvas')
  }
  const change = (id: string, patch: Partial<StudioPanel>): void =>
    updatePanels((panels) =>
      panels.map((panel) => (panel.id === id ? { ...panel, ...patch } : panel))
    )
  const act = (action: StudioAction): void => {
    if (preview) {
      setNotice(
        'Open Command Center in Dobius to use your existing tools. This preview saves creative drafts locally.'
      )
      return
    }
    onAction(action)
  }
  const importImage = async (file?: File): Promise<void> => {
    if (!file) {
      return
    }
    try {
      add('image', {
        title: file.name,
        image: await readStudioImage(file),
        width: 420,
        height: 340
      })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The image could not be imported.')
    }
  }
  const matches = [
    ...surfaces.map((entry) => ({ label: entry.label, run: () => setSurface(entry.id) })),
    ...(['terminal', 'browser', 'agents', 'buzz', 'automations', 'skills', 'system'] as const).map(
      (action) => ({ label: `Open ${action}`, run: () => act(action) })
    ),
    { label: 'Add note', run: () => add('note') },
    { label: 'Create generation brief', run: () => add('brief') },
    ...resources.map((resource) => ({ label: resource.title, run: () => onResource(resource) }))
  ]
    .filter((entry) => entry.label.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 9)
  return (
    <div className="studio-root">
      <header className="studio-header">
        <div className="studio-brand">
          <Box />
          <span>
            VERTEX<small>CREATIVE WORKSPACE</small>
          </span>
        </div>
        <Select
          value={data.activeSpaceId}
          onValueChange={(id) => {
            update((current) => ({ ...current, activeSpaceId: id }))
            setSelectedId(null)
          }}
          disabled={!ready}
        >
          <SelectTrigger className="studio-space-select" aria-label="Active space">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {data.spaces.map((space) => (
              <SelectItem key={space.id} value={space.id}>
                {space.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form
          className="studio-command-search"
          onSubmit={(event) => {
            event.preventDefault()
            if (query.trim() && matches[0]) {
              matches[0].run()
              setQuery('')
            }
          }}
        >
          <Search className="size-4" />
          <Input
            aria-label="Search tools and views"
            value={query}
            placeholder="Find a tool, view, or session…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('')
              }
            }}
          />
          {query && (
            <div className="studio-search-results">
              {matches.length ? (
                matches.map((entry) => (
                  <button
                    type="button"
                    key={entry.label}
                    onClick={() => {
                      entry.run()
                      setQuery('')
                    }}
                  >
                    {entry.label}
                    <ArrowUpRight className="size-3.5" />
                  </button>
                ))
              ) : (
                <p>No matching tools or sessions.</p>
              )}
            </div>
          )}
        </form>
        <span className="studio-save">
          <Check className="size-3.5" />
          {saveState}
        </span>
      </header>
      <nav className="studio-surface-nav" aria-label="Studio views">
        {surfaces.map((entry) => (
          <Button
            key={entry.id}
            size="sm"
            variant={surface === entry.id ? 'secondary' : 'ghost'}
            aria-current={surface === entry.id ? 'page' : undefined}
            onClick={() => {
              setSurface(entry.id)
              setSelectedId(null)
            }}
          >
            {entry.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={inspectorOpen}
          onClick={() => setInspectorOpen(!inspectorOpen)}
        >
          Inspector
        </Button>
        <Button className="ml-auto" size="sm" variant="ghost" onClick={() => act('buzz')}>
          Buzz <ArrowUpRight />
        </Button>
      </nav>
      {(error || notice) && (
        <div className="studio-notice" role="status">
          {error || notice}
          {!error && <button onClick={() => setNotice('')}>Dismiss</button>}
        </div>
      )}
      <div className="studio-body">
        <aside className="studio-sidebar scrollbar-sleek">
          <div className="studio-section-title">Workspace</div>
          <form
            className="studio-new-space"
            onSubmit={(event) => {
              event.preventDefault()
              if (!spaceName.trim()) {
                return
              }
              const id = crypto.randomUUID()
              update((current) => ({
                ...current,
                activeSpaceId: id,
                spaces: [...current.spaces, { id, name: spaceName.trim(), panels: [] }]
              }))
              setSpaceName('')
              setSelectedId(null)
            }}
          >
            <Input
              aria-label="New space name"
              placeholder="New space…"
              value={spaceName}
              onChange={(event) => setSpaceName(event.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              size="icon-sm"
              aria-label="Create space"
              disabled={!ready || !spaceName.trim()}
            >
              <Plus />
            </Button>
          </form>
          {data.spaces.map((space) => (
            <button
              key={space.id}
              className="studio-space-row"
              data-current={space.id === activeSpace.id}
              onClick={() => {
                update((current) => ({ ...current, activeSpaceId: space.id }))
                setSelectedId(null)
                setSurface('canvas')
              }}
            >
              <Folder className="size-4" />
              <span>{space.name}</span>
              <small>{space.panels.length}</small>
            </button>
          ))}
          <div className="studio-section-title mt-6">Create</div>
          <button className="studio-space-row" onClick={() => add('brief')} disabled={!ready}>
            <Layers className="size-4" />
            Generation brief
          </button>
          <button
            className="studio-space-row"
            onClick={() => fileInput.current?.click()}
            disabled={!ready}
          >
            <ImagePlus className="size-4" />
            Reference image
          </button>
          <button className="studio-space-row" onClick={() => add('note')} disabled={!ready}>
            <StickyNote className="size-4" />
            Research note
          </button>
          <StudioSessions resources={resources} add={add} zoom={zoom} setZoom={setZoom} />
        </aside>
        <main className="studio-main">
          {!ready ? (
            <div className="p-8 text-sm text-muted-foreground">
              {error
                ? 'Workspace unavailable. Saved content has not been overwritten.'
                : 'Opening your saved workspace…'}
            </div>
          ) : surface === 'canvas' ? (
            <StudioCanvas
              panels={activeSpace.panels}
              selectedId={selectedId}
              zoom={zoom}
              onSelect={setSelectedId}
              onChange={change}
              onRemove={(id) => {
                updatePanels((panels) => panels.filter((panel) => panel.id !== id))
                setSelectedId(null)
              }}
              onAdd={add}
              onAction={act}
              onImport={() => fileInput.current?.click()}
              resources={resources}
              onResource={onResource}
            />
          ) : surface === 'review' ? (
            <StudioReview
              key={activeSpace.id}
              panels={activeSpace.panels}
              annotations={data.annotations}
              onAnnotations={(annotations) => update((current) => ({ ...current, annotations }))}
              onImport={() => fileInput.current?.click()}
            />
          ) : surface === 'editor' ? (
            <MiniPaintEditor
              image={
                selected?.kind === 'image'
                  ? selected
                  : activeSpace.panels.find((panel) => panel.kind === 'image')
              }
              onBack={() => setSurface('canvas')}
            />
          ) : surface === 'command' || surface === 'knowledge' ? (
            <StudioOverview
              surface={surface}
              data={data}
              act={act}
              add={add}
              setSurface={setSurface}
              openSpace={(id, panelId) => {
                update((current) => ({ ...current, activeSpaceId: id }))
                setSelectedId(panelId ?? null)
                setSurface('canvas')
              }}
            />
          ) : (
            <StudioRecords
              key={surface}
              kind={surface}
              records={data.records}
              onChange={(records) => update((current) => ({ ...current, records }))}
            />
          )}
        </main>
        {surface === 'canvas' && inspectorOpen && (
          <StudioInspector
            panel={selected}
            onChange={(patch) => selected && change(selected.id, patch)}
            onDuplicate={() =>
              selected &&
              add(selected.kind, {
                ...selected,
                id: crypto.randomUUID(),
                title: `${selected.title} copy`,
                x: selected.x + 32,
                y: selected.y + 32
              })
            }
            onAction={act}
            onAddNote={() => add('note')}
            onEditImage={() => setSurface('editor')}
          />
        )}
      </div>
      <input
        ref={fileInput}
        className="hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Import reference image"
        onChange={(event) => {
          void importImage(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </div>
  )
}
