import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: (v: string) => Buffer.from(v), decryptString: (v: Buffer) => v.toString() } }))
import { makeConnectedService } from '../../../dobius/src/main/telegram-account/test-support'
it('a connected revoke completing socket teardown must not overwrite a newer pause', async () => {
 const { service, client, vault } = makeConnectedService()
 expect((await service.restore()).ok).toBe(true)
 let finish!: () => void
 client.disconnect.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
 const pending = service.revoke()
 await vi.waitFor(() => expect(client.disconnect).toHaveBeenCalledOnce())
 await service.pause()
 expect(service.snapshot().phase).toBe('paused')
 const pausedState = structuredClone(vault.state)
 finish()
 expect(await pending).toEqual({ ok: false, error: 'stale-operation' })
 expect(service.snapshot().phase).toBe('paused')
 expect(vault.state).toEqual(pausedState)
})
