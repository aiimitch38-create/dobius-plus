// Signs a nostr event "as" a given owner pubkey, which can be either the
// local human's own Communications identity or one of this machine's Dobius
// custom agents acting as a managed repository owner (see
// agent-participant-identity-store.ts's file comment — that's exactly the
// signing primitive it exists for). Neither of those two source files is
// under communications/agents/ or communications/identity/, so importing
// their narrow, already-stable exports here does not cross this feature's
// off-limits boundaries.
import { ensureParticipantIdentity, signParticipantEvent } from '../participant-identity-store'
import { ensureAgentIdentity, signAsAgent } from '../agent-participant-identity-store'
import { listAgents } from '../../agents/agents-store'
import type { SignedCommunicationsEvent } from './relay-publish'

export type UnsignedEvent = { kind: number; content: string; tags: string[][]; createdAt?: number }

function normalizePubkey(pubkey: string): string {
  return pubkey.trim().toLowerCase()
}

/** Finds which local Dobius agent (if any) owns the given Communications pubkey. */
async function findManagedAgentIdByPubkey(pubkey: string): Promise<string | null> {
  const target = normalizePubkey(pubkey)
  for (const agent of listAgents()) {
    const identity = ensureAgentIdentity(agent.id)
    if (normalizePubkey(identity.pubkey) === target) {return agent.id}
  }
  return null
}

/**
 * Signs `event` as `ownerPubkey`. Resolution order: the local human identity
 * (if it IS the owner), then a managed Dobius agent with that identity, else
 * throws — this machine has no way to sign on behalf of an owner it doesn't
 * control, which is a real constraint, not a missing feature.
 */
export async function signAsOwner(ownerPubkey: string, event: UnsignedEvent): Promise<SignedCommunicationsEvent> {
  const participant = ensureParticipantIdentity()
  if (normalizePubkey(participant.pubkey) === normalizePubkey(ownerPubkey)) {
    return signParticipantEvent(event)
  }
  const agentId = await findManagedAgentIdByPubkey(ownerPubkey)
  if (agentId) {
    return signAsAgent(agentId, event)
  }
  throw new Error(`No local identity controls owner ${ownerPubkey} — cannot sign on its behalf`)
}
