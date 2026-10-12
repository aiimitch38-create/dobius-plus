export type PersistedSecretField = 'opencodeSessionCookie' | 'httpProxyUrl' | 'browserKagiSessionLink'

// Field names only: secret values never cross this boundary.
export type SecretStorageStatus = {
  encryptionAvailable: boolean
  // Secrets changed this session that could not be encrypted: they live in
  // memory only and the data file keeps its previous encrypted value.
  sessionOnlySecrets: PersistedSecretField[]
  // Stored secrets this session could not decrypt (keychain denied or reset):
  // kept on disk untouched and blank in memory.
  undecryptableSecrets: PersistedSecretField[]
}
