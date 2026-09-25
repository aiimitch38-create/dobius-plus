import { describe, expect, it, vi } from 'vitest'
import type { CustomAgent } from '../../../../shared/agents'
import { saveBriefDirective } from './AgentBriefingCard'

describe('saveBriefDirective (#40)', () => {
  it('guards the brief.md write with the copy the tune dialog loaded', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const agent = { id: 'a1' } as CustomAgent
    await saveBriefDirective({ agent, current: 'Loaded brief.\n', draft: 'Edited brief.\n' }, write)
    expect(write).toHaveBeenCalledWith('a1', 'brief', 'Edited brief.\n', 'Loaded brief.\n')
  })
})
