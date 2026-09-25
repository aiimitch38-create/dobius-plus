import { describe, expect, it, vi } from 'vitest'
import type { AgentReadableFiles } from '../../../../shared/agents'
import { DEFAULT_AGENT_FILES } from './agent-default-files'
import { writeEditedAgentFiles } from './use-agent-identity-files'

const loaded: AgentReadableFiles = { ...DEFAULT_AGENT_FILES, memory: '- Old fact.\n' }

describe('writeEditedAgentFiles (#40)', () => {
  it('does not submit an untouched memory.md when only another file changed', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    const result = await writeEditedAgentFiles({
      agentId: 'a1',
      files: { ...loaded, soul: 'Edited soul.\n' },
      baseline: loaded,
      write
    })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('a1', 'soul', 'Edited soul.\n', loaded.soul)
    expect(result).toEqual({ written: ['soul'], error: null })
  })

  it('guards an edited memory.md with the loaded copy', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    await writeEditedAgentFiles({
      agentId: 'a1',
      files: { ...loaded, memory: '- New fact.\n' },
      baseline: loaded,
      write
    })
    expect(write).toHaveBeenCalledWith('a1', 'memory', '- New fact.\n', '- Old fact.\n')
  })

  it('reports partial progress and the conflict error', async () => {
    const conflict = new Error('AGENT_FILE_CONFLICT: memory.md')
    const write = vi.fn(async (_id: string, name: string) => {
      if (name === 'memory') {
        throw conflict
      }
    })
    const result = await writeEditedAgentFiles({
      agentId: 'a1',
      files: { ...loaded, soul: 'S\n', memory: 'M\n' },
      baseline: loaded,
      write
    })
    expect(result).toEqual({ written: ['soul'], error: conflict })
  })

  it('writes every file for a brand-new agent', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    await writeEditedAgentFiles({ agentId: 'a1', files: loaded, baseline: null, write })
    expect(write).toHaveBeenCalledTimes(6)
    expect(write).toHaveBeenCalledWith('a1', 'memory', loaded.memory, undefined)
  })
})
