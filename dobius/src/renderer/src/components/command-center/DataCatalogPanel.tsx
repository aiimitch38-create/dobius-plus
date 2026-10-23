import { useCallback, useMemo, useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { useAppStore } from '../../store'
import { catalogTargetFromSelection, useDataCatalog } from './use-data-catalog'
import type { PreviewInvalidationSource } from '../../../../shared/data-catalog-preview-invalidation'

export function DataCatalogPanel(): React.JSX.Element {
  const environments = useAppStore((state) => state.runtimeEnvironments)
  const [targetSelection, setTargetSelection] = useState('')
  const [filter, setFilter] = useState('')
  const target = useMemo(
    () => catalogTargetFromSelection(targetSelection, environments),
    [environments, targetSelection]
  )
  const subscribePreviewInvalidations = useCallback<PreviewInvalidationSource>(
    (listener) => window.api.runtime.onDataCatalogPreviewInvalidated(listener),
    []
  )
  const catalog = useDataCatalog(
    target,
    target?.kind === 'local' ? subscribePreviewInvalidations : null
  )
  const selectedRootId = catalog.selectedRoot?.rootId ?? ''
  const visibleEntries = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    return query
      ? catalog.page.entries.filter((entry) =>
          `${entry.name} ${entry.relativePath}`.toLocaleLowerCase().includes(query)
        )
      : catalog.page.entries
  }, [catalog.page.entries, filter])

  return (
    <section className="mt-8 border-t border-border pt-6" aria-labelledby="data-catalog-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="data-catalog-title" className="text-base font-semibold">
            Registered files
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Browse file names and basic metadata from folders explicitly registered for this host.
            Original files stay in their folders; backup coverage is unknown.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void catalog.refreshRoots()}
          disabled={!target || catalog.roots.phase === 'loading'}
        >
          Refresh
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium" htmlFor="catalog-host">
            Host
          </label>
          <Select
            value={targetSelection}
            onValueChange={(value) => {
              setTargetSelection(value)
              setFilter('')
            }}
          >
            <SelectTrigger id="catalog-host" aria-label="Catalog host">
              <SelectValue placeholder="Choose local or registered host" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">This computer</SelectItem>
              {environments.map((environment) => (
                <SelectItem key={environment.id} value={`environment:${environment.id}`}>
                  {environment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium" htmlFor="catalog-root">
            Registered folder
          </label>
          <Select
            value={selectedRootId}
            onValueChange={(value) => {
              catalog.selectRoot(value)
            }}
            disabled={
              !target || catalog.roots.phase !== 'ready' || catalog.roots.roots.length === 0
            }
          >
            <SelectTrigger id="catalog-root" aria-label="Registered folder">
              <SelectValue placeholder="Choose a registered folder" />
            </SelectTrigger>
            <SelectContent>
              {catalog.roots.roots.map((root) => (
                <SelectItem key={root.rootId} value={root.rootId}>
                  {root.label} · {root.kind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {catalog.roots.phase === 'idle' ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Choose a host to view its registered folders.
        </p>
      ) : null}
      {catalog.roots.phase === 'loading' ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Loading registered folders…
        </p>
      ) : null}
      {catalog.roots.phase === 'denied' ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          This host denied catalog access.
        </p>
      ) : null}
      {catalog.roots.phase === 'unavailable' ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {catalog.roots.error ?? 'Catalog is unavailable on this host.'}
        </p>
      ) : null}
      {catalog.roots.phase === 'ready' && catalog.roots.roots.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No folders are registered on this host. Add folders in Settings on that computer.
        </p>
      ) : null}

      {catalog.selectedRoot ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Filter listed entries"
              placeholder="Filter listed entries"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="max-w-sm"
            />
            <span className="text-xs text-muted-foreground">
              Filters only the entries loaded for this folder.
            </span>
          </div>
          {catalog.page.phase === 'loading' && catalog.page.entries.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              Reading file metadata…
            </p>
          ) : null}
          {catalog.page.phase === 'denied' ? (
            <p role="alert" className="text-sm text-destructive">
              Access to this folder was denied. Refresh the folder list.
            </p>
          ) : null}
          {catalog.page.phase === 'unavailable' ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 text-sm text-destructive"
            >
              <span>{catalog.page.error ?? catalog.page.reason ?? 'Catalog is unavailable.'}</span>
              <Button variant="outline" size="sm" onClick={catalog.refreshRoot}>
                Refresh folder
              </Button>
            </div>
          ) : null}
          {(catalog.page.phase === 'complete' || catalog.page.phase === 'partial') &&
          catalog.page.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No file metadata is available in this folder.
            </p>
          ) : null}
          {catalog.page.entries.length > 0 ? (
            <div className="max-h-80 overflow-auto rounded-md border border-border scrollbar-sleek">
              <ul aria-label="Registered file metadata" className="divide-y divide-border">
                {visibleEntries.map((entry) => (
                  <li
                    key={entry.entryId}
                    className="flex min-w-0 items-start justify-between gap-4 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{entry.name}</span>
                      <span className="block break-all font-mono text-xs text-muted-foreground">
                        {entry.relativePath}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-muted-foreground">
                      {entry.kind}
                      {entry.sizeBytes === null ? '' : ` · ${formatBytes(entry.sizeBytes)}`}
                      {target?.kind === 'local' &&
                      catalog.previewPolicy?.state === 'local' &&
                      catalog.previewPolicy.desktopPreviewEnabled ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-2"
                          onClick={() => catalog.previewEntry(entry.entryId)}
                          disabled={catalog.preview.phase === 'loading'}
                          aria-label={`Preview ${entry.name}`}
                        >
                          Preview
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {target?.kind === 'environment' ? (
            <p role="status" className="text-xs text-muted-foreground">
              Text preview is unavailable for remote runtime connections.
            </p>
          ) : null}
          {target?.kind === 'local' && catalog.previewPolicy === null ? (
            <p role="status" className="text-xs text-muted-foreground">
              Checking text-preview permission…
            </p>
          ) : null}
          {target?.kind === 'local' &&
          (catalog.previewPolicy?.state === 'unavailable' ||
            catalog.previewPolicy?.state === 'denied') ? (
            <p role="status" className="text-xs text-muted-foreground">
              Text-preview permission is unavailable for this folder.
            </p>
          ) : null}
          {target?.kind === 'local' &&
          catalog.previewPolicy?.state === 'local' &&
          !catalog.previewPolicy.desktopPreviewEnabled ? (
            <p className="text-xs text-muted-foreground">
              Text previews are off for this folder. Change this permission in Settings.
            </p>
          ) : null}
          {catalog.preview.phase === 'loading' ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading selected text preview…
            </p>
          ) : null}
          {catalog.preview.phase === 'failed' ? (
            <p role="alert" className="text-sm text-muted-foreground">
              {catalog.preview.reason}
            </p>
          ) : null}
          {catalog.preview.phase === 'visible' ? (
            <section
              className="space-y-2 rounded-md border border-border p-3"
              aria-label="Text preview"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Plain text preview · clears when this window loses focus
                </p>
                <Button variant="outline" size="sm" onClick={() => void catalog.clearPreview()}>
                  Close preview
                </Button>
              </div>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
                {catalog.preview.text}
              </pre>
            </section>
          ) : null}
          {(catalog.page.phase === 'complete' || catalog.page.phase === 'partial') &&
          catalog.page.entries.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {catalog.page.reason === 'response_limit'
                ? 'Display limit reached; more entries are not loaded.'
                : catalog.page.cursor
                  ? catalog.page.phase === 'partial'
                    ? 'This listing is partial. Load the next metadata page to continue.'
                    : 'Load the next metadata page to continue.'
                  : catalog.page.reason === 'scan_limit'
                    ? 'This listing is partial; the scan limit was reached.'
                    : 'Listing complete.'}
            </p>
          ) : null}
          {catalog.page.cursor ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void catalog.loadMore()}
              disabled={catalog.page.phase === 'loading'}
            >
              {catalog.page.phase === 'loading' ? 'Loading…' : 'Load more metadata'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let size = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024
    unit = units[index]
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${unit}`
}
