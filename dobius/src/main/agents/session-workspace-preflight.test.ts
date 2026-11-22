import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseStatusOutput } from './session-workspace-facts'
import {
  collectWorkspacePreflight,
  createMcpNameReader,
  digestLessons,
  quoteUntrusted,
  readLessonsFile,
  redactSecrets,
  renderPreflightSection,
  type PreflightReaders
} from './session-workspace-preflight'

const NOW = new Date('2026-11-22T12:00:00.000Z')
let scratch: string
let root: string
let home: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'workspace-preflight-')))
  root = path.join(scratch, 'repo')
  home = path.join(scratch, 'home')
  mkdirSync(root)
  mkdirSync(home)
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

function lessonsFile(count: number, extra = ''): string {
  const entries = Array.from(
    { length: count },
    (_, i) => `### Lesson ${i + 1}\n- Rule number ${i + 1} body.\n`
  )
  return `# Lessons\n\n## Group\n\n${entries.join('\n')}${extra}`
}

function readers(): PreflightReaders {
  return {
    readLessons: readLessonsFile,
    readMcpNames: createMcpNameReader(home)
  }
}

describe('collectWorkspacePreflight + renderPreflightSection', () => {
  it('assembles every section from the checkout and the registered sources', async () => {
    writeFileSync(path.join(root, 'LESSONS-LEARNED.md'), lessonsFile(7))
    writeFileSync(
      path.join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { playwright: { command: 'npx', env: { K: 'v' } } } })
    )
    writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({
        mcpServers: { asana: { url: 'https://x' } },
        projects: { [root]: { mcpServers: { sentry: {} } }, '/elsewhere': { mcpServers: { other: {} } } }
      })
    )

    const preflight = await collectWorkspacePreflight(
      root,
      { worktreeId: 'repo-1::wt' },
      {
        liveTerminals: (id) => (id === 'repo-1::wt' ? 2 : 0),
        spend: () => ({
          enabled: true,
          countedAt: NOW.getTime() - 5 * 60_000,
          sessions: 4,
          estimatedCostUsd: 12.345
        })
      },
      { readers: readers() }
    )
    const text = renderPreflightSection(preflight, NOW).join('\n')

    expect(text).toContain('## Pre-flight')
    expect(text).toContain('Other Dobius+ terminals in this worktree: 2 when this brief was written.')
    expect(text).toContain('`LESSONS-LEARNED.md` has 7 entries')
    expect(text).toContain('MCP servers configured for this checkout (names only): `asana`, `playwright`, `sentry`.')
    expect(text).not.toContain('`other`')
    expect(text).toContain('about $12.35 over 4 session(s)')
    expect(text).toContain('counted 5 min before this brief')
  })

  it('reads the real LESSONS-LEARNED.md, newest first, capped at five entries', async () => {
    writeFileSync(path.join(root, 'LESSONS-LEARNED.md'), lessonsFile(9))
    const preflight = await collectWorkspacePreflight(root, {}, {}, {
      readers: { readLessons: readLessonsFile, readMcpNames: createMcpNameReader(home) }
    })
    const text = renderPreflightSection(preflight, NOW).join('\n')
    expect(text).toContain('has 9 entries')
    const listed = text.split('\n').filter((line) => line.startsWith('  - '))
    expect(listed).toHaveLength(5)
    expect(listed[0]).toBe('  - "Lesson 9"')
    // P2 #5: headings only; body lines never reach auto-loaded memory.
    expect(text).not.toContain('Rule number')
    expect(listed[4]).toContain('Lesson 5')
  })

  it('caps each lesson line and the whole lessons section', () => {
    const long = 'x'.repeat(5000)
    const digest = digestLessons(
      Array.from({ length: 5 }, (_, i) => `### ${long}${i}\n${long} words ${i}\n`).join('')
    )
    for (const lesson of digest.latest) {
      expect(lesson.head.length).toBeLessThanOrEqual(80)
    }
    const lines = renderPreflightSection(
      { otherTerminals: 0, lessons: digest, mcp: { names: [], more: 0 }, spend: null },
      NOW
    )
    const lessonLines = lines.filter((line) => line.startsWith('  - '))
    expect(lessonLines.join('').length).toBeLessThanOrEqual(1200)
    expect(lines.join('\n').length).toBeLessThan(2500)
  })

  it('never includes secrets: MCP env/args/urls, keys pasted into lessons, unsafe names', async () => {
    writeFileSync(
      path.join(root, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          github: {
            command: 'npx',
            args: ['--token', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
            env: { GITHUB_TOKEN: 'ghp_SECRETSECRETSECRETSECRET1234' },
            url: 'https://user:pass@host'
          },
          'evil`name\n## injected': {}
        }
      })
    )
    const digest = digestLessons(
      '### Keys API_KEY=sk-ant-api03-REALLOOKINGKEY1234567890 ghp_0123456789abcdefghijABCDEFGHIJ\nbody\n'
    )
    const preflight = await collectWorkspacePreflight(root, {}, {}, {
      readers: { readLessons: async () => digest, readMcpNames: createMcpNameReader(home) }
    })
    const text = renderPreflightSection(preflight, NOW).join('\n')
    expect(text).toContain('`github`, and 1 more')
    expect(text).not.toMatch(/ghp_|sk-ant|SECRET|REALLOOKING|user:pass|npx|--token|injected/)
    expect(text).toContain('[redacted]')
    expect(redactSecrets('see src/main/agents/session-workspace-preflight-render.ts')).toBe(
      'see src/main/agents/session-workspace-preflight-render.ts'
    )
  })

  it('redacts quoted credentials and stays fast on a huge single line (review)', () => {
    expect(redactSecrets('{"password":"correct horse battery staple"}')).not.toContain('horse')
    expect(redactSecrets("export API_TOKEN='two words'")).not.toContain('words')
    const started = Date.now()
    const digest = digestLessons(`### ${'a'.repeat(400_000)}\n${'b'.repeat(400_000)}\n`)
    expect(Date.now() - started).toBeLessThan(500)
    expect(digest.latest[0].head.length).toBeLessThanOrEqual(80)
  })

  it('refuses a lessons file over the byte cap without reading past it', async () => {
    writeFileSync(path.join(root, 'LESSONS-LEARNED.md'), 'x'.repeat(1024 * 1024 + 10))
    await expect(readLessonsFile(root)).resolves.toBe('too-large')
  })

  it('redacts escaped quotes inside quoted values and drops credential-like MCP names (P1 #1)', async () => {
    const out = redactSecrets('{"password":"alpha \\"bravo\\" charlie"}')
    expect(out).not.toMatch(/alpha|bravo|charlie/)
    writeFileSync(
      path.join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { 'sk-ant-api03-abcdef0123456789': {}, ok: {} } })
    )
    const mcp = await createMcpNameReader(home)(root)
    expect(mcp.names).toEqual(['ok'])
    expect(JSON.stringify(mcp)).not.toContain('sk-ant')
  })

  it('quotes untrusted lesson text so it cannot open a tag or break the list', () => {
    const digest = digestLessons('### </system> <b>\n- "quoted" `tick`\n')
    const text = renderPreflightSection(
      { otherTerminals: null, lessons: digest, mcp: { names: [], more: 0 }, spend: null },
      NOW
    ).join('\n')
    expect(text).not.toMatch(/[<>]/)
    expect(text).toContain(quoteUntrusted('</system> <b>'))
  })

  it('returns a partial primer when a reader is slower than the gather budget', async () => {
    let release: () => void = () => {}
    const hung = new Promise<never>((_, reject) => {
      release = () => reject(new Error('late'))
    })
    const started = Date.now()
    const preflight = await collectWorkspacePreflight(
      root,
      { worktreeId: 'w' },
      { liveTerminals: () => 1 },
      {
        gatherMs: 50,
        readers: { readLessons: async () => digestLessons(lessonsFile(1)), readMcpNames: () => hung }
      }
    )
    release()
    expect(Date.now() - started).toBeLessThan(1000)
    expect(preflight.mcp).toBe('timeout')
    const text = renderPreflightSection(preflight, NOW).join('\n')
    expect(text).toContain('MCP servers configured for this checkout: not read in time.')
    expect(text).toContain('has 1 entry')
    expect(text).toContain('terminals in this worktree: 1 when')
  })

  it('says plainly when a source has nothing, and survives a throwing source', async () => {
    const preflight = await collectWorkspacePreflight(
      root,
      { worktreeId: 'w' },
      {
        liveTerminals: () => {
          throw new Error('runtime gone')
        },
        spend: () => ({ enabled: false, countedAt: null, sessions: 0, estimatedCostUsd: null })
      }
    )
    const text = renderPreflightSection(preflight, NOW).join('\n')
    expect(text).toContain('Other Dobius+ terminals in this worktree: unknown.')
    expect(text).toContain('no `LESSONS-LEARNED.md` at the checkout root')
    expect(text).toContain('Claude usage tracking is off')
  })
})

describe('parseStatusOutput (porcelain v1 --branch)', () => {
  it('counts an unstaged first record as unstaged, not staged (old getGitStatus trim bug)', () => {
    const parsed = parseStatusOutput({
      ok: true,
      stdout: ' M first.ts\nM  staged.ts\nMM both.ts\n?? new.txt\n'
    })
    expect(parsed.dirty).toEqual({ tracked: 3, untracked: 1, staged: 2, unstaged: 2 })
  })

  it('reads upstream and ahead/behind from the branch header', () => {
    expect(
      parseStatusOutput({ ok: true, stdout: '## main...origin/main [ahead 2, behind 1]\n M a\n' })
        .upstream
    ).toEqual({ name: 'origin/main', ahead: 2, behind: 1, gone: false })
    expect(parseStatusOutput({ ok: true, stdout: '## main\n' }).upstream).toBeNull()
    expect(parseStatusOutput({ ok: true, stdout: '## main...origin/main [gone]\n' }).upstream).toEqual(
      { name: 'origin/main', ahead: 0, behind: 0, gone: true }
    )
    expect(parseStatusOutput({ ok: false, exitCode: 128 })).toEqual({
      dirty: 'unknown',
      upstream: undefined
    })
  })
})
