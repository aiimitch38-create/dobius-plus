// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataCatalogPanel } from './DataCatalogPanel'

const runtime = vi.hoisted(() => ({
  call: vi.fn(),
  environments: [{ id: 'env-1', name: 'Workstation' }]
}))
vi.mock('../../runtime/runtime-rpc-client', () => ({ callRuntimeRpc: runtime.call }))
vi.mock('../../store', () => ({
  useAppStore: (select: (state: unknown) => unknown) =>
    select({ runtimeEnvironments: runtime.environments })
}))

afterEach(() => {
  cleanup()
  runtime.call.mockReset()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})

function installPreviewInvalidationApi(): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { runtime: { onDataCatalogPreviewInvalidated: vi.fn(() => () => {}) } }
  })
}

const root = {
  rootId: 'catalog:one',
  kind: 'repository',
  label: 'Project',
  generation: '8de3037a-7171-4399-af40-9e31de2cb59e'
}
const entry = {
  entryId: 'd'.repeat(64),
  rootId: root.rootId,
  relativePath: 'docs/README.md',
  name: 'README.md',
  kind: 'file',
  sizeBytes: 2048,
  modifiedAtMs: 100,
  contentDigestSha256: null,
  backupCoverage: 'unknown',
  availability: 'available',
  observedAtMs: 200
}
const nextEntry = {
  ...entry,
  entryId: 'e'.repeat(64),
  relativePath: 'docs/SECOND.md',
  name: 'SECOND.md'
}

describe('Knowledge metadata catalog panel', () => {
  it('shows bounded metadata only and keeps results as non-opening rows', async () => {
    installPreviewInvalidationApi()
    runtime.call.mockImplementation(async (target, method) => {
      expect(target).toEqual({ kind: 'local' })
      if (method === 'data.catalog.roots') {
        return { state: 'ready', roots: [root] }
      }
      if (method === 'data.catalog.preview.policy') {
        return {
          state: 'local',
          desktopPreviewEnabled: false,
          deviceIds: [],
          devices: []
        }
      }
      return {
        state: 'complete',
        rootId: root.rootId,
        entries: [entry],
        cursor: null,
        scannedEntries: 1,
        reason: null
      }
    })
    render(<DataCatalogPanel />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Catalog host' }))
    fireEvent.click(await screen.findByRole('option', { name: 'This computer' }))
    await waitFor(() =>
      expect(runtime.call).toHaveBeenCalledWith(
        { kind: 'local' },
        'data.catalog.roots',
        undefined,
        expect.anything()
      )
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Registered folder' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Project · repository' }))
    expect(await screen.findByText('docs/README.md')).toBeTruthy()
    expect(screen.getByText(/2\.0 KiB/)).toBeTruthy()
    expect(screen.getByText('Listing complete.')).toBeTruthy()
    expect(screen.getByText(/backup coverage is unknown/i)).toBeTruthy()
    expect(screen.queryByText(/content|frontmatter|note body/i)).toBeNull()
    const row = screen.getByText('docs/README.md').closest('li')
    expect(row).toBeTruthy()
    expect(within(row as HTMLElement).queryByRole('button')).toBeNull()
    expect(runtime.call.mock.calls.map((call) => call[1])).toContain('data.catalog.preview.policy')
    expect(
      runtime.call.mock.calls.some(
        (call) =>
          String(call[1]).startsWith('data.catalog.preview.') &&
          call[1] !== 'data.catalog.preview.policy'
      )
    ).toBe(false)
  })

  it('reads a listed file only after explicit Preview and shows text after finish', async () => {
    installPreviewInvalidationApi()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const text = 'hello <script>not executed</script>'
    const dataBase64 = Buffer.from(text).toString('base64')
    runtime.call.mockImplementation(async (target, method) => {
      expect(target).toEqual({ kind: 'local' })
      if (method === 'data.catalog.roots') {
        return { state: 'ready', roots: [root] }
      }
      if (method === 'data.catalog.preview.policy') {
        return { state: 'local', desktopPreviewEnabled: true, deviceIds: [], devices: [] }
      }
      if (method === 'data.catalog.preview.resolve') {
        return {
          state: 'ready',
          entryRef: 'r'.repeat(32),
          rootId: root.rootId,
          generation: root.generation,
          fileVersion: 'b'.repeat(64),
          sizeBytes: String(Buffer.byteLength(text)),
          expiresInMs: 30_000
        }
      }
      if (method === 'data.catalog.preview.start') {
        return {
          state: 'ready',
          previewSessionId: '22222222-2222-4222-8222-222222222222',
          rootId: root.rootId,
          generation: root.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: String(Buffer.byteLength(text)),
          chunkBytes: 16_384,
          expiresInMs: 60_000
        }
      }
      if (method === 'data.catalog.preview.chunk') {
        return {
          state: 'chunk',
          previewSessionId: '22222222-2222-4222-8222-222222222222',
          rootId: root.rootId,
          generation: root.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: String(Buffer.byteLength(text)),
          offset: 0,
          nextOffset: Buffer.byteLength(text),
          final: true,
          dataBase64
        }
      }
      if (method === 'data.catalog.preview.finish') {
        return { state: 'visible', leaseTtlMs: 30_000 }
      }
      if (method === 'data.catalog.preview.close') {
        return { state: 'cancelled' }
      }
      return {
        state: 'complete',
        rootId: root.rootId,
        entries: [entry],
        cursor: null,
        scannedEntries: 1,
        reason: null
      }
    })
    render(<DataCatalogPanel />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Catalog host' }))
    fireEvent.click(await screen.findByRole('option', { name: 'This computer' }))
    await waitFor(() =>
      expect(
        (screen.getByRole('combobox', { name: 'Registered folder' }) as HTMLButtonElement).disabled
      ).toBe(false)
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Registered folder' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Project · repository' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Preview README.md' }))
    expect(await screen.findByText(text)).toBeTruthy()
    const preview = screen.getByLabelText('Text preview')
    expect(preview.querySelector('pre')?.textContent).toBe(text)
    expect(runtime.call.mock.calls.map((call) => call[1])).toContain('data.catalog.preview.finish')
    expect(
      runtime.call.mock.calls.find((call) => call[1] === 'data.catalog.preview.resolve')?.[2]
    ).toEqual({
      rootId: root.rootId,
      generation: root.generation,
      entryId: entry.entryId
    })
  })

  it('clears visible entry A before entry B grant resolves', async () => {
    installPreviewInvalidationApi()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const textA = 'visible entry A'
    let releaseBGrant!: (value: unknown) => void
    let activeText = textA
    runtime.call.mockImplementation(async (_target, method, params) => {
      if (method === 'data.catalog.roots') {
        return { state: 'ready', roots: [root] }
      }
      if (method === 'data.catalog.preview.policy') {
        return { state: 'local', desktopPreviewEnabled: true, deviceIds: [], devices: [] }
      }
      if (method === 'data.catalog.preview.resolve') {
        const entryId = (params as { entryId: string }).entryId
        if (entryId === nextEntry.entryId) {
          return new Promise<unknown>((resolve) => {
            releaseBGrant = resolve
          })
        }
        activeText = textA
        return {
          state: 'ready',
          entryRef: 'r'.repeat(32),
          rootId: root.rootId,
          generation: root.generation,
          fileVersion: 'b'.repeat(64),
          sizeBytes: String(Buffer.byteLength(textA)),
          expiresInMs: 30_000
        }
      }
      if (method === 'data.catalog.preview.start') {
        return {
          state: 'ready',
          previewSessionId: '22222222-2222-4222-8222-222222222222',
          rootId: root.rootId,
          generation: root.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: String(Buffer.byteLength(activeText)),
          chunkBytes: 16_384,
          expiresInMs: 60_000
        }
      }
      if (method === 'data.catalog.preview.chunk') {
        return {
          state: 'chunk',
          previewSessionId: '22222222-2222-4222-8222-222222222222',
          rootId: root.rootId,
          generation: root.generation,
          fileVersion: 'b'.repeat(64),
          totalBytes: String(Buffer.byteLength(activeText)),
          offset: 0,
          nextOffset: Buffer.byteLength(activeText),
          final: true,
          dataBase64: Buffer.from(activeText).toString('base64')
        }
      }
      if (method === 'data.catalog.preview.finish') {
        return { state: 'visible', leaseTtlMs: 30_000 }
      }
      if (method === 'data.catalog.preview.close') {
        return { state: 'cancelled' }
      }
      return {
        state: 'complete',
        rootId: root.rootId,
        entries: [entry, nextEntry],
        cursor: null,
        scannedEntries: 2,
        reason: null
      }
    })
    render(<DataCatalogPanel />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Catalog host' }))
    fireEvent.click(await screen.findByRole('option', { name: 'This computer' }))
    await waitFor(() =>
      expect(
        (screen.getByRole('combobox', { name: 'Registered folder' }) as HTMLButtonElement).disabled
      ).toBe(false)
    )
    fireEvent.click(screen.getByRole('combobox', { name: 'Registered folder' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Project · repository' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Preview README.md' }))
    expect(await screen.findByText(textA)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Preview SECOND.md' }))
    await waitFor(() => expect(releaseBGrant).toBeTypeOf('function'))
    expect(screen.queryByText(textA)).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Loading selected text preview')

    releaseBGrant({ state: 'denied' })
    expect(await screen.findByText(/Preview access is not enabled/)).toBeTruthy()
    expect(screen.queryByText(textA)).toBeNull()
  })
})
