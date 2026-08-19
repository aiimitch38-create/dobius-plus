// RPC method definitions for the 18 identity-keychain Buzz commands, in the
// same `defineMethod` shape every other runtime RPC domain uses (see
// src/main/runtime/rpc/methods/accounts.ts for the established pattern).
//
// This file does NOT register itself anywhere — wiring it into
// `ALL_RPC_METHODS` (src/main/runtime/rpc/methods/index.ts) and into the
// `COMMUNICATIONS_RUNTIME_METHODS` allowlist (src/shared/communications-bridge.ts)
// are both outside this package's ownership for this slice; see ALLOWLIST in
// the build report for the exact two-line diff each needs.
import { z } from 'zod'
import { defineMethod, type RpcAnyMethod } from '../../runtime/rpc/core'
import { archiveEvents, readArchivedEvents } from './event-archive-store'
import {
  archiveIdentity,
  listArchivedIdentities,
  resolveOaOwner,
  unarchiveIdentity
} from './identity-archival-relay'
import {
  createNcryptsecBackup,
  exportNsecViaSecureWindow,
  importIdentityViaSecureWindow,
  saveNcryptsecCopy,
  verifyNcryptsecBackup
} from './identity-export-import'
import {
  getLegacyWorkspaceStorage,
  persistCurrentIdentity,
  signNostrIdentityBinding,
  signOut
} from './identity-lifecycle'
import { generateBackupPassphrase } from './backup-passphrase'
import { nip44DecryptFromSelf, nip44EncryptToSelf } from './nip44-self'

const HEX_64 = z.string().regex(/^[0-9a-f]{64}$/, 'expected 64 lowercase hex characters')

const ArchiveScopeSchema = z.object({
  scopeType: z.enum(['channel_h', 'owner_p', 'referenced_e']),
  scopeValue: z.string().min(1)
})

const ArchiveEventsParams = z.object({
  candidates: z.array(
    z.object({
      rawEventJson: z.string().min(1),
      matchedScope: ArchiveScopeSchema
    })
  )
})

const ReadArchivedEventsParams = z.object({
  scopeType: z.enum(['channel_h', 'owner_p', 'referenced_e']),
  scopeValue: z.string().min(1),
  kinds: z.array(z.number().int()).nullable().optional(),
  before: z.object({ createdAt: z.number(), id: z.string() }).nullable().optional(),
  limit: z.number().int().positive().optional()
})

const ArchiveIdentityParams = z.object({
  targetPubkey: HEX_64,
  content: z.string().optional(),
  reason: z.string().optional(),
  replacedBy: z.string().optional()
})

const UnarchiveIdentityParams = z.object({
  targetPubkey: HEX_64,
  content: z.string().optional(),
  reason: z.string().optional()
})

const ResolveOaOwnerParams = z.object({ targetPubkey: HEX_64 })

const CreateNcryptsecBackupParams = z.object({ password: z.string().min(1) })

const SaveNcryptsecCopyParams = z.object({ ncryptsec: z.string().min(1) })

const VerifyNcryptsecBackupParams = z.object({
  ncryptsec: z.string().min(1),
  password: z.string().min(1)
})

const GenerateBackupPassphraseParams = z.object({
  words: z.number().int().optional(),
  separator: z.string().optional()
})

const Nip44EncryptParams = z.object({ plaintext: z.string() })
const Nip44DecryptParams = z.object({ payload: z.string() })

const SignNostrIdentityBindingParams = z.object({
  challengeId: z.string(),
  nonce: z.string(),
  verificationCode: z.string(),
  origin: z.string(),
  expiresAt: z.string()
})

export const IDENTITY_RPC_METHODS: readonly RpcAnyMethod[] = [
  defineMethod({
    name: 'communications.identity.archiveEvents',
    params: ArchiveEventsParams,
    handler: (params) => archiveEvents(params.candidates)
  }),
  defineMethod({
    name: 'communications.identity.readArchivedEvents',
    params: ReadArchivedEventsParams,
    handler: (params) =>
      readArchivedEvents(params.scopeType, params.scopeValue, {
        kinds: params.kinds ?? null,
        before: params.before ?? null,
        limit: params.limit
      })
  }),
  defineMethod({
    name: 'communications.identity.archiveIdentity',
    params: ArchiveIdentityParams,
    handler: (params) => archiveIdentity(params)
  }),
  defineMethod({
    name: 'communications.identity.unarchiveIdentity',
    params: UnarchiveIdentityParams,
    handler: (params) => unarchiveIdentity(params)
  }),
  defineMethod({
    name: 'communications.identity.listArchivedIdentities',
    params: null,
    handler: () => listArchivedIdentities()
  }),
  defineMethod({
    name: 'communications.identity.resolveOaOwner',
    params: ResolveOaOwnerParams,
    handler: (params) => resolveOaOwner(params.targetPubkey)
  }),
  defineMethod({
    name: 'communications.identity.persistCurrentIdentity',
    params: null,
    handler: () => persistCurrentIdentity()
  }),
  defineMethod({
    name: 'communications.identity.signOut',
    params: null,
    handler: () => {
      signOut()
      return null
    }
  }),
  defineMethod({
    name: 'communications.identity.getLegacyWorkspaceStorage',
    params: null,
    handler: () => getLegacyWorkspaceStorage()
  }),
  defineMethod({
    name: 'communications.identity.signNostrIdentityBinding',
    params: SignNostrIdentityBindingParams,
    handler: (params) => signNostrIdentityBinding(params)
  }),
  defineMethod({
    name: 'communications.identity.exportNsec',
    params: null,
    handler: () => exportNsecViaSecureWindow()
  }),
  defineMethod({
    name: 'communications.identity.importIdentity',
    params: null,
    handler: () => importIdentityViaSecureWindow()
  }),
  defineMethod({
    name: 'communications.identity.createNcryptsecBackup',
    params: CreateNcryptsecBackupParams,
    handler: (params) => createNcryptsecBackup(params.password)
  }),
  defineMethod({
    name: 'communications.identity.saveNcryptsecCopy',
    params: SaveNcryptsecCopyParams,
    handler: (params) => saveNcryptsecCopy(params.ncryptsec)
  }),
  defineMethod({
    name: 'communications.identity.verifyNcryptsecBackup',
    params: VerifyNcryptsecBackupParams,
    handler: (params) => verifyNcryptsecBackup(params.ncryptsec, params.password)
  }),
  defineMethod({
    name: 'communications.identity.generateBackupPassphrase',
    params: GenerateBackupPassphraseParams,
    handler: (params) => generateBackupPassphrase(params)
  }),
  defineMethod({
    name: 'communications.identity.nip44EncryptToSelf',
    params: Nip44EncryptParams,
    handler: (params) => nip44EncryptToSelf(params.plaintext)
  }),
  defineMethod({
    name: 'communications.identity.nip44DecryptFromSelf',
    params: Nip44DecryptParams,
    handler: (params) => nip44DecryptFromSelf(params.payload)
  })
]
