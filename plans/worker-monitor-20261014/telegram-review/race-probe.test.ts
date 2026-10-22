import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => value.toString()
} }))

import {
  FakeTelegramClient, GROUPS, incoming, makeConnectedService
} from '../../../dobius/src/main/telegram-account/test-support'

describe('read-only Telegram source race probes', () => {
  it('shows duplicate concurrent inbound callbacks both enter the reply port', async () => {
    let release!: (value: string) => void
    const reply = vi.fn(() => new Promise<string>((resolve) => { release = resolve }))
    const { service, client } = makeConnectedService({ reply })
    await service.restore()
    await service.startReplies()

    client.emit(incoming())
    client.emit(incoming())
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(2))

    release('synthetic response')
    await vi.waitFor(() => expect(service.snapshot().drafts).toHaveLength(1))
    expect(reply).toHaveBeenCalledTimes(2)
    await service.pause()
  })

  it('shows a pending reply restoring the old group selection over a newer save', async () => {
    let release!: (value: string) => void
    const reply = vi.fn(() => new Promise<string>((resolve) => { release = resolve }))
    const client = new FakeTelegramClient()
    client.dialogs = [...GROUPS, { id: '-1005', title: 'Other', kind: 'group' }]
    const { service } = makeConnectedService({ client, reply })
    await service.restore()
    await service.startReplies()

    client.emit(incoming())
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1))
    await service.selectGroups(['-1002', '-1003', '-1005'])
    expect(service.snapshot().selectedGroups.map((group) => group.id)).toEqual(['-1002', '-1003', '-1005'])

    release('synthetic response')
    await vi.waitFor(() => expect(service.snapshot().drafts).toHaveLength(1))
    expect(service.snapshot().selectedGroups.map((group) => group.id)).toEqual(['-1002', '-1003', '-1005'])
    await service.pause()
  })
})
