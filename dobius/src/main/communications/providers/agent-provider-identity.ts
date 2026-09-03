import { ensureAgentIdentity } from '../agent-participant-identity-store'

/**
 * Binds (or re-reads) the Nostr keypair participant for a provider instance so
 * the agent appears in channels/DMs as itself — the same primitive huddle
 * agents and the native Buzz directory use. Only the pubkey leaves this store;
 * private key material never does.
 */
export function bindProviderIdentity(agentId: string): { pubkey: string } {
  return ensureAgentIdentity(agentId)
}
