import { describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  app: { relaunch: vi.fn(), exit: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  safeStorage: {
    decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
    encryptString: vi.fn((value: string) => Buffer.from(value)),
    isEncryptionAvailable: vi.fn(() => true)
  },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn(), once: vi.fn(), removeListener: vi.fn() }
}))

async function loadMethods() {
  vi.resetModules()
  vi.doMock('electron', () => electronMock)
  const { IDENTITY_RPC_METHODS } = await import('./identity-rpc-methods')
  return IDENTITY_RPC_METHODS
}

describe('identity-rpc-methods', () => {
  it('registers exactly the 18 identity-keychain commands, all uniquely named', async () => {
    const methods = await loadMethods()
    expect(methods).toHaveLength(18)

    const names = methods.map((m) => m.name)
    expect(new Set(names).size).toBe(18)
    for (const name of names) {
      expect(name.startsWith('communications.identity.')).toBe(true)
    }
  })

  it('covers every one of the 18 Buzz command names from the coverage manifest', async () => {
    const methods = await loadMethods()
    const covered = new Set(methods.map((m) => m.name.replace('communications.identity.', '')))

    const expectedByBuzzCommand: Record<string, string> = {
      archive_events: 'archiveEvents',
      archive_identity: 'archiveIdentity',
      create_ncryptsec_backup: 'createNcryptsecBackup',
      generate_backup_passphrase: 'generateBackupPassphrase',
      get_legacy_workspace_storage: 'getLegacyWorkspaceStorage',
      get_nsec: 'exportNsec',
      import_identity: 'importIdentity',
      list_archived_identities: 'listArchivedIdentities',
      nip44_decrypt_from_self: 'nip44DecryptFromSelf',
      nip44_encrypt_to_self: 'nip44EncryptToSelf',
      persist_current_identity: 'persistCurrentIdentity',
      read_archived_events: 'readArchivedEvents',
      resolve_oa_owner: 'resolveOaOwner',
      save_ncryptsec_copy: 'saveNcryptsecCopy',
      sign_nostr_identity_binding: 'signNostrIdentityBinding',
      sign_out: 'signOut',
      unarchive_identity: 'unarchiveIdentity',
      verify_ncryptsec_backup: 'verifyNcryptsecBackup'
    }
    expect(Object.keys(expectedByBuzzCommand)).toHaveLength(18)

    for (const [buzzCommand, methodSuffix] of Object.entries(expectedByBuzzCommand)) {
      expect(covered.has(methodSuffix), `missing RPC method for Buzz command ${buzzCommand}`).toBe(true)
    }
  })

  it('validates resolveOaOwner params reject a malformed pubkey', async () => {
    const methods = await loadMethods()
    const resolveOaOwner = methods.find((m) => m.name === 'communications.identity.resolveOaOwner')
    expect(resolveOaOwner?.params?.safeParse({ targetPubkey: 'not-hex' }).success).toBe(false)
    expect(resolveOaOwner?.params?.safeParse({ targetPubkey: 'a'.repeat(64) }).success).toBe(true)
  })

  it('validates createNcryptsecBackup requires a non-empty password', async () => {
    const methods = await loadMethods()
    const create = methods.find((m) => m.name === 'communications.identity.createNcryptsecBackup')
    expect(create?.params?.safeParse({ password: '' }).success).toBe(false)
    expect(create?.params?.safeParse({ password: 'secret' }).success).toBe(true)
  })

  it('exportNsec and importIdentity take no params (the secret never rides on the RPC call)', async () => {
    const methods = await loadMethods()
    const exportNsec = methods.find((m) => m.name === 'communications.identity.exportNsec')
    const importIdentity = methods.find((m) => m.name === 'communications.identity.importIdentity')
    expect(exportNsec?.params).toBeNull()
    expect(importIdentity?.params).toBeNull()
  })
})
