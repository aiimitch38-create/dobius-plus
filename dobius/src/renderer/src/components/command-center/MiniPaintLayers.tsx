import { Eye, EyeOff, Layers, Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'

type LayerItem = { id: string; name: string; visible: boolean; opacity: number }

export function MiniPaintLayers({
  layers,
  activeLayerId,
  onSelect,
  onToggleVisibility,
  onOpacityChange,
  onAdd,
  onRemove
}: {
  layers: LayerItem[]
  activeLayerId: string
  onSelect: (id: string) => void
  onToggleVisibility: (id: string) => void
  onOpacityChange: (opacity: number) => void
  onAdd: () => void
  onRemove: () => void
}): React.JSX.Element {
  return (
    <aside className="studio-paint-layers" aria-label="Layers">
      <div className="studio-paint-layers-header">
        <Layers className="size-4" />
        <span>Layers</span>
        <Button size="icon-xs" variant="ghost" aria-label="Add layer" onClick={onAdd}>
          <Plus />
        </Button>
      </div>
      <p className="studio-paint-help">
        Paint locally in Vertex. Every stroke stays in this workspace until you export.
      </p>
      {layers.map((layer) => (
        <div key={layer.id} className="studio-paint-layer" data-active={layer.id === activeLayerId}>
          <button className="studio-paint-layer-select" onClick={() => onSelect(layer.id)}>
            <span>{layer.name}</span>
            <small>{Math.round(layer.opacity * 100)}%</small>
          </button>
          <button
            className="studio-paint-layer-visibility"
            aria-label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name}`}
            onClick={() => onToggleVisibility(layer.id)}
          >
            {layer.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
        </div>
      ))}
      <label className="studio-paint-opacity">
        <span>Opacity</span>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(
            (layers.find((layer) => layer.id === activeLayerId)?.opacity ?? 1) * 100
          )}
          onChange={(event) => onOpacityChange(Number(event.target.value) / 100)}
        />
      </label>
      <div className="studio-paint-layer-actions">
        <Button variant="outline" size="sm" onClick={onRemove} disabled={layers.length <= 1}>
          <Trash2 />
          Remove
        </Button>
      </div>
    </aside>
  )
}
