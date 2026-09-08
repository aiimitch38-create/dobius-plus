import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// agent-identity-files resolves its root from os.homedir(), so the whole suite
// is pointed at a temp home — without this it would write into the real
// ~/.dobius/agents and clobber live crew memory.
const home = vi.hoisted(() => ({ dir: '' }))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, default: { ...actual, homedir: () => home.dir }, homedir: () => home.dir }
})

async function load() {
  vi.resetModules()
  return import('./agent-identity-files')
}

const AGENT = 'test-agent'

function memoryPath(): string {
  return path.join(home.dir, '.dobius', 'agents', AGENT, 'memory.md')
}

beforeEach(() => {
  home.dir = mkdtempSync(path.join(os.tmpdir(), 'dobius-identity-'))
})

afterEach(() => {
  rmSync(home.dir, { recursive: true, force: true })
})

describe('appendAgentMemory', () => {
  it('replaces the placeholder with the first real fact instead of keeping both', async () => {
    const { appendAgentMemory, readAgentPromptFiles } = await load()

    // Touch memory.md first so it exists as the shipped template.
    await load().then((m) => m.readAgentFiles(AGENT))
    expect(readFileSync(memoryPath(), 'utf-8')).toContain('Add durable facts')

    const count = appendAgentMemory(AGENT, 'The dev server for pc-next runs on port 3003 over HTTPS.')

    expect(count).toBe(1)
    const written = readFileSync(memoryPath(), 'utf-8')
    expect(written).toBe('- The dev server for pc-next runs on port 3003 over HTTPS.\n')
    expect(written).not.toContain('Add durable facts')

    // The prompt builder strips a file that still equals its template; a file
    // holding a real fact must survive into the prompt.
    expect(readAgentPromptFiles(AGENT).memory).toContain('port 3003')
  })

  it('accumulates facts in order and collapses whitespace', async () => {
    const { appendAgentMemory } = await load()

    appendAgentMemory(AGENT, 'First fact.')
    const count = appendAgentMemory(AGENT, '  Second\n   fact.  ')

    expect(count).toBe(2)
    expect(readFileSync(memoryPath(), 'utf-8')).toBe('- First fact.\n- Second fact.\n')
  })

  it('ignores an empty or whitespace-only note', async () => {
    const { appendAgentMemory } = await load()

    appendAgentMemory(AGENT, 'Real fact.')
    expect(appendAgentMemory(AGENT, '   \n  ')).toBe(0)
    expect(readFileSync(memoryPath(), 'utf-8')).toBe('- Real fact.\n')
  })

  it('caps the file so memory cannot grow without bound', async () => {
    const { appendAgentMemory } = await load()

    const dir = path.dirname(memoryPath())
    mkdirSync(dir, { recursive: true })
    const seeded = Array.from({ length: 205 }, (_, i) => `- seeded ${i}`).join('\n')
    writeFileSync(memoryPath(), `${seeded}\n`, 'utf-8')

    const count = appendAgentMemory(AGENT, 'newest fact')

    expect(count).toBe(200)
    const lines = readFileSync(memoryPath(), 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(200)
    expect(lines.at(-1)).toBe('- newest fact')
    // The oldest entries fall off the front, not the back.
    expect(lines[0]).toBe('- seeded 6')
  })
})
