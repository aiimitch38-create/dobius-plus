import { Checkbox } from '../ui/checkbox'
import type { DataCatalogRootView } from '../../../../shared/data-catalog-roots'
import type { DataCatalogPreviewPolicyResult } from '../../../../shared/data-catalog-preview-schema'

export type PreviewAccessChange = {
  desktopPreviewEnabled?: boolean
  deviceId?: string
  checked?: boolean
}

export function DataCatalogPreviewPermissions({
  root,
  policy,
  busy,
  onChange
}: {
  root: DataCatalogRootView
  policy: DataCatalogPreviewPolicyResult | undefined
  busy: boolean
  onChange: (change: PreviewAccessChange) => void
}): React.JSX.Element {
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h5 className="text-xs font-medium">Text preview permissions</h5>
      <p className="text-xs text-muted-foreground">
        Preview is separate from browse access. Only an explicitly selected file is read; text stays
        in the catalog view and is not sent to agents.
      </p>
      {policy?.state === 'local' ? (
        <>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={policy.desktopPreviewEnabled}
              disabled={busy}
              onCheckedChange={(value) => onChange({ desktopPreviewEnabled: value === true })}
              aria-label={`Allow text previews on this computer for ${root.label}`}
            />
            <span>Allow text previews on this computer</span>
          </label>
          <h6 className="pt-1 text-xs font-medium">Allow text previews on paired phones</h6>
          {policy.devices.length === 0 ? (
            <p className="text-xs text-muted-foreground">No paired phones are available.</p>
          ) : (
            policy.devices.map((device) => (
              <label key={device.deviceId} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={policy.deviceIds.includes(device.deviceId)}
                  disabled={busy}
                  onCheckedChange={(value) =>
                    onChange({ deviceId: device.deviceId, checked: value === true })
                  }
                  aria-label={`Allow ${device.name} to preview text in ${root.label}`}
                />
                <span>{device.name}</span>
              </label>
            ))
          )}
        </>
      ) : policy === undefined ? (
        <p role="status" className="text-xs text-muted-foreground">
          Checking preview permissions…
        </p>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          Preview permissions are unavailable. Existing access remains unchanged.
        </p>
      )}
    </div>
  )
}
