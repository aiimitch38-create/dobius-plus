import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderPlus, RefreshCw, Trash2 } from 'lucide-react'
import { DataCatalogRootsResult, DataCatalogRootView } from '../../../../shared/data-catalog-roots'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'
import {
  DataCatalogPreviewPolicyResultSchema,
  DataCatalogSetPreviewAccessRequestSchema,
  type DataCatalogPreviewPolicyResult
} from '../../../../shared/data-catalog-preview-schema'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  DataCatalogPreviewPermissions,
  type PreviewAccessChange
} from './DataCatalogPreviewPermissions'
import {
  catalogRootKindLabel,
  isCatalogDeviceRoster,
  isCatalogRootRemoved,
  type DataCatalogDevice
} from './data-catalog-setting-state'

type Device = DataCatalogDevice
const ROOT_KINDS = [
  ['repository', 'Repository'],
  ['folder-workspace', 'Workspace folder'],
  ['obsidian-vault', 'Obsidian vault'],
  ['artifact', 'Artifact folder']
] as const

export function DataCatalogSetting(): React.JSX.Element {
  const [roots, setRoots] = useState<DataCatalogRootView[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [rootState, setRootState] = useState<'loading' | 'ready' | 'unavailable' | 'denied'>(
    'loading'
  )
  const [error, setError] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [previewPolicies, setPreviewPolicies] = useState<
    Record<string, DataCatalogPreviewPolicyResult>
  >({})
  const [kind, setKind] = useState<(typeof ROOT_KINDS)[number][0]>('folder-workspace')
  const [busy, setBusy] = useState(false)
  const requestId = useRef(0)

  const refresh = useCallback(async () => {
    const current = ++requestId.current
    setRootState('loading')
    setError(null)
    setPreviewPolicies({})
    const [rootOutcome, deviceOutcome] = await Promise.allSettled([
      callRuntimeRpc<unknown>({ kind: 'local' }, 'data.catalog.roots'),
      callRuntimeRpc<unknown>({ kind: 'local' }, 'data.catalog.devices')
    ])
    if (current !== requestId.current) {
      return
    }
    if (rootOutcome.status === 'rejected') {
      setRoots([])
      setRootState('unavailable')
      setError(
        rootOutcome.reason instanceof Error
          ? rootOutcome.reason.message
          : 'Folder registrations are unavailable.'
      )
    } else {
      const parsed = DataCatalogRootsResult.safeParse(rootOutcome.value)
      if (
        !parsed.success ||
        (parsed.success && parsed.data.roots.some((root) => !Array.isArray(root.allowedDeviceIds)))
      ) {
        setRoots([])
        setRootState('unavailable')
        setError('The folder registration response was invalid.')
      } else {
        setRoots(parsed.data.roots)
        setRootState(parsed.data.state)
        const policies = await Promise.all(
          parsed.data.roots.map(async (root) => {
            try {
              const raw = await callRuntimeRpc<unknown>(
                { kind: 'local' },
                'data.catalog.preview.policy',
                {
                  rootId: root.rootId,
                  generation: root.generation
                }
              )
              const policy = DataCatalogPreviewPolicyResultSchema.safeParse(raw)
              return [
                root.rootId,
                policy.success ? policy.data : { state: 'unavailable' as const }
              ] as const
            } catch {
              return [root.rootId, { state: 'unavailable' as const }] as const
            }
          })
        )
        if (current === requestId.current) {
          setPreviewPolicies(Object.fromEntries(policies))
        }
        if (parsed.data.state === 'unavailable') {
          setError('Folder registrations are unavailable.')
        }
        if (parsed.data.state === 'denied') {
          setError('This computer denied folder registration access.')
        }
      }
    }
    if (deviceOutcome.status === 'rejected') {
      setDevices([])
      setDeviceError(
        deviceOutcome.reason instanceof Error
          ? deviceOutcome.reason.message
          : 'Paired devices are unavailable.'
      )
    } else {
      const value: unknown = deviceOutcome.value
      if (isCatalogDeviceRoster(value)) {
        setDevices(value.devices)
        setDeviceError(null)
      } else {
        setDevices([])
        setDeviceError('The paired-device response was invalid.')
      }
    }
  }, [])

  useEffect(() => {
    const requestSequence = requestId
    void refresh()
    return () => {
      ++requestSequence.current
    }
  }, [refresh])

  const chooseRoot = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const raw = await callRuntimeRpc<unknown>({ kind: 'local' }, 'data.catalog.chooseRoot', {
        kind
      })
      if (raw === null) {
        return
      }
      const parsed = DataCatalogRootView.safeParse(raw)
      if (!parsed.success || !Array.isArray(parsed.data.allowedDeviceIds)) {
        throw new Error('The folder registration response was invalid.')
      }
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The folder could not be registered.')
    } finally {
      setBusy(false)
    }
  }

  const updateDeviceAccess = async (
    root: DataCatalogRootView,
    deviceId: string,
    checked: boolean
  ): Promise<void> => {
    if (busy) {
      return
    }
    const next = new Set(root.allowedDeviceIds ?? [])
    if (checked) {
      next.add(deviceId)
    } else {
      next.delete(deviceId)
    }
    setBusy(true)
    setError(null)
    try {
      const raw = await callRuntimeRpc<unknown>({ kind: 'local' }, 'data.catalog.setAccess', {
        rootId: root.rootId,
        deviceIds: [...next]
      })
      const parsed = DataCatalogRootView.safeParse(raw)
      if (!parsed.success || !Array.isArray(parsed.data.allowedDeviceIds)) {
        throw new Error('The folder access response was invalid.')
      }
      await refresh()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Folder access was not updated.'
      await refresh()
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const updatePreviewAccess = async (
    root: DataCatalogRootView,
    change: PreviewAccessChange
  ): Promise<void> => {
    if (busy) {
      return
    }
    const policy = previewPolicies[root.rootId]
    if (policy?.state !== 'local') {
      return
    }
    const deviceIds = new Set(policy.deviceIds)
    if (change.deviceId) {
      if (change.checked) {
        deviceIds.add(change.deviceId)
      } else {
        deviceIds.delete(change.deviceId)
      }
    }
    setBusy(true)
    setError(null)
    try {
      const request = DataCatalogSetPreviewAccessRequestSchema.parse({
        rootId: root.rootId,
        desktopPreviewEnabled: change.desktopPreviewEnabled ?? policy.desktopPreviewEnabled,
        deviceIds: [...deviceIds]
      })
      await callRuntimeRpc<unknown>({ kind: 'local' }, 'data.catalog.setPreviewAccess', request)
      await refresh()
    } catch {
      await refresh()
      setError('Preview permissions could not be updated. Existing access remains unchanged.')
    } finally {
      setBusy(false)
    }
  }

  const removeRoot = async (rootId: string): Promise<void> => {
    if (busy) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const raw = await callRuntimeRpc<unknown>({ kind: 'local' }, 'data.catalog.removeRoot', {
        rootId
      })
      if (!isCatalogRootRemoved(raw)) {
        throw new Error('The folder registration was not removed.')
      }
      await refresh()
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'The folder registration could not be removed.'
      await refresh()
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="mt-8 space-y-4 border-t border-border pt-6"
      aria-labelledby="data-catalog-setting-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="data-catalog-setting-title" className="text-base font-semibold">
            Registered data folders
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Choose folders to make their file names and basic metadata available in Knowledge and to
            explicitly shared paired devices. Original files remain in place. Backup coverage is
            unknown.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={rootState === 'loading' || busy}
        >
          <RefreshCw /> Refresh
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs font-medium" htmlFor="data-catalog-root-kind">
            Folder type
          </label>
          <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
            <SelectTrigger id="data-catalog-root-kind" aria-label="Folder type" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROOT_KINDS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => void chooseRoot()} disabled={busy}>
          <FolderPlus /> Choose folder…
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {deviceError ? (
        <p role="alert" className="text-sm text-destructive">
          {deviceError}
        </p>
      ) : null}
      {rootState === 'loading' ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading folder registrations…
        </p>
      ) : null}
      {rootState === 'ready' && roots.length === 0 ? (
        <p className="text-sm text-muted-foreground">No folders are registered.</p>
      ) : null}
      {rootState === 'unavailable' ? (
        <p className="text-sm text-muted-foreground">
          Existing files are unchanged. Fix the registration store or retry before changing folder
          access.
        </p>
      ) : null}
      {roots.map((root) => (
        <article key={root.rootId} className="space-y-3 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="break-words text-sm font-medium">{root.label}</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                {catalogRootKindLabel(root.kind)} · Registered folder
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void removeRoot(root.rootId)}
              disabled={busy || rootState !== 'ready'}
              aria-label={`Remove ${root.label} registration`}
            >
              <Trash2 /> Remove registration
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Removing registration revokes catalog access only; it never deletes or moves files.
          </p>
          <div className="space-y-2">
            <h5 className="text-xs font-medium">Share browse access with paired devices</h5>
            {devices.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No paired devices are available. No phone access is granted by default.
              </p>
            ) : (
              devices.map((device) => {
                const checked = root.allowedDeviceIds?.includes(device.deviceId) ?? false
                return (
                  <label key={device.deviceId} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={checked}
                      disabled={busy || rootState !== 'ready'}
                      onCheckedChange={(value) =>
                        void updateDeviceAccess(root, device.deviceId, value === true)
                      }
                      aria-label={`Allow ${device.name} to browse ${root.label}`}
                    />
                    <span>{device.name}</span>
                  </label>
                )
              })
            )}
          </div>
          <DataCatalogPreviewPermissions
            root={root}
            policy={previewPolicies[root.rootId]}
            busy={busy || rootState !== 'ready'}
            onChange={(change) => void updatePreviewAccess(root, change)}
          />
        </article>
      ))}
    </section>
  )
}
