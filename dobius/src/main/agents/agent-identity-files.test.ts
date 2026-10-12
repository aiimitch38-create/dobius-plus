import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAgentFileConflictError } from '../../shared/agent-file-conflict'
import { parseExpectedAgentFile, readAgentFiles, writeAgentFile } from './agent-identity-files'

const AGENT_ID = 'agent-1'
let home: string

function memoryPath(): string {
  return path.join(home, '.dobius', 'agents', AGENT_ID, 'memory.md')
}

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'agent-identity-files-'))
  vi.spyOn(os, 'homedir').mockReturnValue(home)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(home, { recursive: true, force: true })
})

describe('writeAgentFile revision check (#40)', () => {
  it('refuses to overwrite memory an agent appended after the form loaded it', () => {
    const loaded = readAgentFiles(AGENT_ID).memory
    const appended = `${loaded}- Agent learned this during a run.\n`
    writeFileSync(memoryPath(), appended, 'utf-8')

    let thrown: unknown = null
    try {
      writeAgentFile(AGENT_ID, 'memory', `${loaded}- User edit.\n`, loaded)
    } catch (error) {
      thrown = error
    }

    expect(isAgentFileConflictError(thrown)).toBe(true)
    expect(readFileSync(memoryPath(), 'utf-8')).toBe(appended)
  })

  it('writes when the file still matches the loaded copy', () => {
    const loaded = readAgentFiles(AGENT_ID).memory
    writeAgentFile(AGENT_ID, 'memory', '- New fact.\n', loaded)
    expect(readFileSync(memoryPath(), 'utf-8')).toBe('- New fact.\n')
  })

  it('treats a retry whose content is already on disk as success', () => {
    readAgentFiles(AGENT_ID)
    writeFileSync(memoryPath(), '- Same.\n', 'utf-8')
    expect(() => writeAgentFile(AGENT_ID, 'memory', '- Same.\n', 'stale copy')).not.toThrow()
    expect(readFileSync(memoryPath(), 'utf-8')).toBe('- Same.\n')
  })

  it('leaves no temp files behind after a save', () => {
    const loaded = readAgentFiles(AGENT_ID).soul
    writeAgentFile(AGENT_ID, 'soul', 'Calm.\n', loaded)
    const dir = path.dirname(memoryPath())
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('parseExpectedAgentFile', () => {
  it('rejects a non-string revision instead of writing unchecked', () => {
    expect(() => parseExpectedAgentFile(42)).toThrow()
    expect(() => parseExpectedAgentFile(null)).toThrow()
    expect(parseExpectedAgentFile(undefined)).toBeUndefined()
    expect(parseExpectedAgentFile('x')).toBe('x')
  })
})
