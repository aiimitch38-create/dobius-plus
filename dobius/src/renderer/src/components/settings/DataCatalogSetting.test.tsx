// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataCatalogSetting } from './DataCatalogSetting'

const runtime = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../../runtime/runtime-rpc-client', () => ({ callRuntimeRpc: runtime.call }))
afterEach(() => {
  cleanup()
  runtime.call.mockReset()
})

const deviceId = '8de3037a-7171-4399-af40-9e31de2cb59e'
const root = {
  rootId: 'catalog:local',
  kind: 'folder-workspace',
  label: 'Workspace',
  generation: '8de3037a-7171-4399-af40-9e31de2cb59e',
  allowedDeviceIds: []
}
function respond(method: string, overrides: { accessGranted?: boolean } = {}) {
  if (method === 'data.catalog.roots') {
    return {
      state: 'ready',
      roots: [{ ...root, ...(overrides.accessGranted ? { allowedDeviceIds: [deviceId] } : {}) }]
    }
  }
  if (method === 'data.catalog.devices') {
    return { devices: [{ deviceId, name: 'Phone' }] }
  }
  if (method === 'data.catalog.preview.policy') {
    return {
      state: 'local',
      desktopPreviewEnabled: false,
      deviceIds: [],
      devices: [{ deviceId, name: 'Phone' }]
    }
  }
  if (method === 'data.catalog.chooseRoot') {
    return null
  }
  if (method === 'data.catalog.setAccess') {
    return { ...root, allowedDeviceIds: [deviceId] }
  }
  if (method === 'data.catalog.removeRoot') {
    return { removed: true }
  }
  return {}
}

describe('local data catalog settings', () => {
  it('uses only local registration methods and treats native-picker cancellation quietly', async () => {
    runtime.call.mockImplementation(async (_target, method) => respond(method))
    render(<DataCatalogSetting />)
    await screen.findByText('Workspace')
    fireEvent.click(screen.getByRole('button', { name: /Choose folder/ }))
    await waitFor(() =>
      expect(runtime.call).toHaveBeenCalledWith({ kind: 'local' }, 'data.catalog.chooseRoot', {
        kind: 'folder-workspace'
      })
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(/Removing registration revokes catalog access only/i)).toBeTruthy()
    expect(screen.getByText(/Backup coverage is unknown/i)).toBeTruthy()
    expect(
      runtime.call.mock.calls.every(([target]) => (target as { kind: string }).kind === 'local')
    ).toBe(true)
  })

  it('requires explicit per-device grants and preserves a permission failure visibly', async () => {
    runtime.call.mockImplementation(async (_target, method) => {
      if (method === 'data.catalog.setAccess') {
        throw new Error('Device is no longer paired')
      }
      return respond(method)
    })
    render(<DataCatalogSetting />)
    await screen.findByText('Workspace')
    const checkbox = screen.getByRole('checkbox', { name: 'Allow Phone to browse Workspace' })
    expect(checkbox.getAttribute('data-state')).toBe('unchecked')
    fireEvent.click(checkbox)
    await screen.findByRole('alert')
    expect(screen.getByText('Device is no longer paired')).toBeTruthy()
    expect(runtime.call).toHaveBeenCalledWith({ kind: 'local' }, 'data.catalog.setAccess', {
      rootId: root.rootId,
      deviceIds: [deviceId]
    })
  })

  it('writes text-preview permissions through the separate local grant method', async () => {
    runtime.call.mockImplementation(async (_target, method) => respond(method))
    render(<DataCatalogSetting />)
    await screen.findByText('Workspace')
    const checkbox = screen.getByRole('checkbox', {
      name: 'Allow text previews on this computer for Workspace'
    })
    fireEvent.click(checkbox)
    await waitFor(() =>
      expect(runtime.call).toHaveBeenCalledWith(
        { kind: 'local' },
        'data.catalog.setPreviewAccess',
        { rootId: root.rootId, desktopPreviewEnabled: true, deviceIds: [] }
      )
    )
    expect(runtime.call).not.toHaveBeenCalledWith(
      { kind: 'local' },
      'data.catalog.setAccess',
      expect.objectContaining({ deviceIds: expect.anything() })
    )
  })

  it('distinguishes a pending preview-policy check from an unavailable permission service', async () => {
    let resolvePolicy!: (value: unknown) => void
    runtime.call.mockImplementation(async (_target, method) => {
      if (method === 'data.catalog.preview.policy') {
        return new Promise((resolve) => {
          resolvePolicy = resolve
        })
      }
      return respond(method)
    })
    render(<DataCatalogSetting />)
    await screen.findByText('Workspace')
    expect(screen.getByText('Checking preview permissions…')).toBeTruthy()

    resolvePolicy({
      state: 'local',
      desktopPreviewEnabled: false,
      deviceIds: [],
      devices: [{ deviceId, name: 'Phone' }]
    })
    expect(
      await screen.findByRole('checkbox', {
        name: 'Allow text previews on this computer for Workspace'
      })
    ).toBeTruthy()
    expect(
      screen.queryByText('Preview permissions are unavailable. Existing access remains unchanged.')
    ).toBeNull()
  })
})
