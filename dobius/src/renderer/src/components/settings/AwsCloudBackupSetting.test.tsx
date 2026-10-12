// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloudBackupApi, CloudBackupStatus } from '../../../../shared/cloud-backup'
import { AwsCloudBackupSetting } from './AwsCloudBackupSetting'
import { getAdvancedPaneSearchEntries } from './advanced-search'

vi.mock('../../store', () => ({
  useAppStore: (select: (state: { settingsSearchQuery: string }) => unknown) =>
    select({ settingsSearchQuery: '' })
}))
afterEach(cleanup)
const empty: CloudBackupStatus = {
  supported: true,
  configured: false,
  enabled: false,
  health: 'not_configured',
  detail: 'Connect AWS to start automatic backups.',
  bucket: '',
  region: 'us-east-1',
  repository: '',
  sources: []
}
const healthy: CloudBackupStatus = {
  ...empty,
  configured: true,
  enabled: true,
  health: 'healthy',
  detail: 'Restore and integrity checks completed.',
  bucket: 'dobius-backups',
  sources: ['/projects']
}
function api(status = empty): CloudBackupApi {
  return {
    getStatus: vi.fn().mockResolvedValue(status),
    connect: vi.fn().mockResolvedValue({ ...healthy, health: 'running' }),
    runNow: vi.fn().mockResolvedValue({ ...healthy, health: 'running' }),
    setEnabled: vi.fn().mockResolvedValue({ ...healthy, enabled: false, health: 'paused' }),
    exportRecoveryKey: vi.fn().mockResolvedValue(true)
  }
}

describe('AWS backup settings', () => {
  it('shows actionable desktop errors without Electron transport details', async () => {
    const bridge = api(healthy)
    vi.mocked(bridge.runNow).mockRejectedValue(
      new Error("Error invoking remote method 'cloudBackup:runNow': Error: AWS access denied.")
    )
    render(<AwsCloudBackupSetting api={bridge} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Back up now' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('AWS access denied.'))
  })
  it('collects credentials, disables concurrent submission, clears secrets, and waits for verification', async () => {
    const bridge = api()
    render(<AwsCloudBackupSetting api={bridge} />)
    await screen.findByLabelText('S3 bucket name')
    fireEvent.change(screen.getByLabelText('S3 bucket name'), {
      target: { value: 'dobius-backups' }
    })
    fireEvent.change(screen.getByLabelText('Access key ID'), { target: { value: 'access-key' } })
    fireEvent.change(screen.getByLabelText('Secret access key'), {
      target: { value: 'secret-key' }
    })
    expect(screen.getByLabelText('Secret access key').getAttribute('type')).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Connect and enable backups' }))
    await waitFor(() =>
      expect(bridge.connect).toHaveBeenCalledWith({
        bucket: 'dobius-backups',
        region: 'us-east-1',
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        sessionToken: ''
      })
    )
    expect((screen.getByLabelText('Secret access key') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('Backup verified')).toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Back up now' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
  it('keeps AWS failures visible and never labels them verified', async () => {
    render(
      <AwsCloudBackupSetting
        api={api({ ...empty, health: 'failed', detail: 'Access denied by S3.' })}
      />
    )
    await screen.findByText('Access denied by S3.')
    expect(screen.queryByText('Backup verified')).toBeNull()
  })
  it('can pause a connected schedule and export a recovery key without revealing it', async () => {
    const bridge = api(healthy)
    render(<AwsCloudBackupSetting api={bridge} />)
    await screen.findByText('Backup verified')
    fireEvent.click(screen.getByRole('button', { name: 'Save recovery key' }))
    await screen.findByText(/Recovery key saved/)
    fireEvent.click(screen.getByRole('button', { name: 'Pause backups' }))
    await screen.findByRole('button', { name: 'Resume backups' })
    expect(bridge.setEnabled).toHaveBeenCalledWith(false)
    expect(bridge.exportRecoveryKey).toHaveBeenCalledOnce()
    expect(screen.queryByText('Backup verified')).toBeNull()
  })
  it('offers no credential form for unsupported clients and is searchable by AWS and S3', async () => {
    render(
      <AwsCloudBackupSetting
        api={api({
          ...empty,
          supported: false,
          health: 'unsupported',
          detail: 'Use desktop settings.'
        })}
      />
    )
    await screen.findByText('Use desktop settings.')
    expect(screen.queryByLabelText('Secret access key')).toBeNull()
    expect(
      getAdvancedPaneSearchEntries().some(
        (entry) => entry.keywords?.includes('s3') && entry.keywords?.includes('aws')
      )
    ).toBe(true)
  })
})
