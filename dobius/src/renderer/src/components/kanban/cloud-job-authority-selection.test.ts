import { describe, expect, it, vi } from 'vitest'
import {
  loadCloudJobAuthority,
  saveCloudJobAuthority,
  resolveCloudJobAuthority,
  CLOUD_JOB_AUTHORITY_KEY
} from './cloud-job-authority-selection'
describe('independent persisted cloud authority', () => {
  it('restores only an explicitly saved registered environment', () => {
    const storage = { getItem: vi.fn(() => JSON.stringify('vps')), setItem: vi.fn() }
    expect(resolveCloudJobAuthority(loadCloudJobAuthority(storage), [{ id: 'vps' }])).toEqual({
      kind: 'environment',
      environmentId: 'vps'
    })
    saveCloudJobAuthority(storage, 'other')
    expect(storage.setItem).toHaveBeenCalledWith(CLOUD_JOB_AUTHORITY_KEY, JSON.stringify('other'))
  })
  it('does not adopt a selected terminal runtime, first registration, local target or removed ID', () => {
    expect(resolveCloudJobAuthority(null, [{ id: 'selected-terminal-runtime' }])).toBeNull()
    expect(resolveCloudJobAuthority('removed', [{ id: 'other' }])).toBeNull()
    expect(loadCloudJobAuthority({ getItem: () => '{bad', setItem: vi.fn() })).toBeNull()
    expect(
      loadCloudJobAuthority({
        getItem: () => {
          throw new Error('storage unavailable')
        },
        setItem: vi.fn()
      })
    ).toBeNull()
  })
})
