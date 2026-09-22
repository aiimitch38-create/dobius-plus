import { Copy, Download, Layers, MessageSquare, Pencil, SlidersHorizontal } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { StudioAction, StudioPanel } from './studio-state'

export function StudioInspector({
  panel,
  onChange,
  onDuplicate,
  onAction,
  onAddNote,
  onEditImage
}: {
  panel?: StudioPanel
  onChange: (patch: Partial<StudioPanel>) => void
  onDuplicate: () => void
  onAction: (action: StudioAction) => void
  onAddNote: () => void
  onEditImage: () => void
}): React.JSX.Element {
  const exportImage = (): void => {
    if (!panel?.image) {
      return
    }
    const source = new Image()
    source.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = source.naturalWidth
      canvas.height = source.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) {
        return
      }
      context.filter = `brightness(${panel.brightness}%) contrast(${panel.contrast}%)`
      context.drawImage(source, 0, 0)
      canvas.toBlob((blob) => {
        if (!blob) {
          return
        }
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${panel.title.replace(/[^a-z0-9-_]/gi, '-')}.png`
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      })
    }
    source.src = panel.image
  }
  return (
    <aside className="studio-inspector scrollbar-sleek">
      <div className="studio-section-title">
        <SlidersHorizontal className="size-4" />
        {panel ? 'Object inspector' : 'Working context'}
      </div>
      {panel ? (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="studio-object-title">Name</Label>
            <Input
              id="studio-object-title"
              value={panel.title}
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['width', 'height'] as const).map((dimension) => (
              <div key={dimension} className="space-y-2">
                <Label htmlFor={`studio-${dimension}`}>
                  {dimension === 'width' ? 'Width' : 'Height'}
                </Label>
                <Input
                  id={`studio-${dimension}`}
                  type="number"
                  min={dimension === 'width' ? 240 : 180}
                  max={dimension === 'width' ? 1200 : 1000}
                  value={panel[dimension]}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      onChange({
                        [dimension]: Math.max(
                          dimension === 'width' ? 240 : 180,
                          Math.min(dimension === 'width' ? 1200 : 1000, value)
                        )
                      })
                    }
                  }}
                />
              </div>
            ))}
          </div>
          {panel.kind === 'brief' && (
            <>
              <div className="space-y-2">
                <Label>Generation provider</Label>
                <Select
                  value={panel.provider}
                  onValueChange={(provider: StudioPanel['provider']) => onChange({ provider })}
                >
                  <SelectTrigger aria-label="Generation provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['ComfyUI', 'Viral Engine', 'Higgsfield'] as const).map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {provider}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="studio-variants">Variations</Label>
                <Input
                  id="studio-variants"
                  type="number"
                  min={1}
                  max={16}
                  value={panel.variants}
                  onChange={(event) =>
                    onChange({
                      variants: Math.max(1, Math.min(16, Number(event.target.value) || 1))
                    })
                  }
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Brief only. Provider execution and ComfyUI workflow editing are not connected in
                this UI yet.
              </p>
            </>
          )}
          {panel.kind === 'image' && (
            <>
              <Button variant="default" size="sm" onClick={onEditImage}>
                <Pencil />
                Open in Vertex Paint
              </Button>
              {(['brightness', 'contrast'] as const).map((property) => (
                <div key={property} className="space-y-2">
                  <Label htmlFor={`studio-${property}`}>
                    {property === 'brightness' ? 'Brightness' : 'Contrast'} · {panel[property]}%
                  </Label>
                  <input
                    id={`studio-${property}`}
                    className="w-full accent-primary"
                    type="range"
                    min="0"
                    max="200"
                    value={panel[property]}
                    onChange={(event) => onChange({ [property]: Number(event.target.value) })}
                  />
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={exportImage}>
                <Download />
                Export edited PNG
              </Button>
              <p className="text-xs text-muted-foreground">
                The original stays intact. Layer compositing and masks are a later editor
                integration.
              </p>
            </>
          )}
          <Button variant="outline" size="sm" onClick={onDuplicate}>
            <Copy />
            Duplicate object
          </Button>
          <p className="text-xs text-muted-foreground">
            Drag the header to move. Drag the lower corner to resize. Both also support arrow keys.
          </p>
        </div>
      ) : (
        <>
          <div className="studio-context-card">
            <Layers className="size-7" />
            <h2>Your space, your tools</h2>
            <p>Collect references, develop directions, and keep your work together.</p>
          </div>
          <Button variant="outline" className="w-full justify-start" onClick={onAddNote}>
            Capture a note
          </Button>
          <Button
            variant="outline"
            className="mt-2 w-full justify-start"
            onClick={() => onAction('agents')}
          >
            Open your agents
          </Button>
          <Button
            variant="outline"
            className="mt-2 w-full justify-start"
            onClick={() => onAction('buzz')}
          >
            <MessageSquare />
            Continue in Buzz
          </Button>
          <div className="mt-8 space-y-2">
            <h3 className="text-sm font-medium">From brief to review</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Save a generation brief, choose its provider and variation count, then organize
              references around it.
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Select an object to edit its properties.
            </p>
          </div>
        </>
      )}
    </aside>
  )
}
