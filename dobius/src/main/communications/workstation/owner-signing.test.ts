import { describe, expect, it, vi } from 'vitest'

const ensureParticipantIdentityMock = vi.fn()
const signParticipantEventMock = vi.fn()
const ensureAgentIdentityMock = vi.fn()
const signAsAgentMock = vi.fn()
const listAgentsMock = vi.fn()

vi.mock('../participant-identity-store', () => ({
  ensureParticipantIdentity: () => ensureParticipantIdentityMock(),
  signParticipantEvent: (event: unknown) => signParticipantEventMock(event)
}))
vi.mock('../agent-participant-identity-store', () => ({
  ensureAgentIdentity: (id: string) => ensureAgentIdentityMock(id),
  signAsAgent: (id: string, event: unknown) => signAsAgentMock(id, event)
}))
vi.mock('../../agents/agents-store', () => ({
  listAgents: () => listAgentsMock()
}))

const { signAsOwner } = await import('./owner-signing')

describe('signAsOwner', () => {
  it('signs with the local participant identity when it IS the owner', async () => {
    ensureParticipantIdentityMock.mockReturnValue({ pubkey: 'OWNER-PUBKEY' })
    signParticipantEventMock.mockReturnValue({ id: 'signed-as-participant' })

    const result = await signAsOwner('owner-pubkey', { kind: 1, content: '', tags: [] })
    expect(result).toEqual({ id: 'signed-as-participant' })
    expect(signAsAgentMock).not.toHaveBeenCalled()
  })

  it('signs with a managed agent identity when the owner matches one', async () => {
    ensureParticipantIdentityMock.mockReturnValue({ pubkey: 'not-the-owner' })
    listAgentsMock.mockReturnValue([{ id: 'agent-1' }, { id: 'agent-2' }])
    ensureAgentIdentityMock.mockImplementation((id: string) => ({
      pubkey: id === 'agent-2' ? 'OWNER-PUBKEY' : 'some-other-pubkey'
    }))
    signAsAgentMock.mockReturnValue({ id: 'signed-as-agent-2' })

    const result = await signAsOwner('owner-pubkey', { kind: 1, content: '', tags: [] })
    expect(signAsAgentMock).toHaveBeenCalledWith('agent-2', expect.any(Object))
    expect(result).toEqual({ id: 'signed-as-agent-2' })
  })

  it('throws when no local identity controls the owner pubkey', async () => {
    ensureParticipantIdentityMock.mockReturnValue({ pubkey: 'not-the-owner' })
    listAgentsMock.mockReturnValue([{ id: 'agent-1' }])
    ensureAgentIdentityMock.mockReturnValue({ pubkey: 'also-not-the-owner' })

    await expect(signAsOwner('owner-pubkey', { kind: 1, content: '', tags: [] })).rejects.toThrow(
      /No local identity controls owner/
    )
  })
})
