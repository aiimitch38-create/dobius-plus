import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import type { LibraryCandidate, LibraryDocument } from '../library-types'
import { adamIngester } from './adam'
import { claudeConversationsIngester } from './claude-conversations'
import { codexConversationsIngester } from './codex-conversations'
import { MAX_FILE_BYTES } from './fs-walk'
import { boundedLines } from './jsonl-lines'
import { obsidianIngester } from './obsidian'
import { dedupeAcrossCheckouts, streamHash } from './project-checkouts'
import { isProjectNotesFile, projectDocsIngester } from './project-docs'

let root: string

beforeEach(() => {
  // Why realpath: the library reports real paths, and macOS tmp is a link.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'library-sources-')))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function put(path: string, text: string): string {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, text)
  return full
}

function jsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n')
}

async function loadAll(candidates: LibraryCandidate[]): Promise<LibraryDocument[]> {
  const docs = await Promise.all(candidates.map((candidate) => candidate.load()))
  return docs.filter((doc): doc is LibraryDocument => doc !== null)
}

const allText = (doc: LibraryDocument): string => doc.sections.map((s) => s.text).join('\n')

describe('project notes', () => {
  it('picks notes files, never code or secret files', () => {
    expect(isProjectNotesFile('plans/7.14.md')).toBe(true)
    expect(isProjectNotesFile('a/docs/guide.md')).toBe(true)
    expect(isProjectNotesFile('HANDOFF-MOBILE-V1.md')).toBe(true)
    expect(isProjectNotesFile('src/random.md')).toBe(false)
    expect(isProjectNotesFile('plans/run.ts')).toBe(false)
  })

  it('skips code, .env and node_modules', async () => {
    const projects = join(root, 'Projects')
    put('Projects/Epoxy/.git/HEAD', 'ref: refs/heads/main')
    put('Projects/Epoxy/CLAUDE.md', '# Epoxy rules\nUse the blue accent.')
    put('Projects/Epoxy/src/app.ts', 'export const x = 1')
    put('Projects/Epoxy/.env', 'SECRET=1')
    put('Projects/Epoxy/node_modules/pkg/README.md', '# pkg')
    const candidates = await projectDocsIngester(projects).list()
    expect(candidates.map((c) => c.path.slice(projects.length))).toEqual(['/Epoxy/CLAUDE.md'])
    const [doc] = await loadAll(candidates)
    expect(doc).toMatchObject({ project: 'Epoxy', title: 'Epoxy rules (CLAUDE.md)' })
  })

  it('reads every worktree, counting a file shared between them once', async () => {
    const projects = join(root, 'Projects')
    const same = '# Epoxy rules\nUse the blue accent.'
    put('Projects/Epoxy/.git/HEAD', 'ref: refs/heads/main')
    put('Projects/Epoxy/CLAUDE.md', same)
    put('Projects/Epoxy/plans/next.md', '# Next\nShip the quote form.')
    // A linked worktree of the same repository, nested in another top folder.
    put('Projects/Epoxy/.git/worktrees/feature/commondir', '../..')
    put('Projects/epoxy-worktrees/feature/.git', `gitdir: ${join(projects, 'Epoxy/.git/worktrees/feature')}`)
    put('Projects/epoxy-worktrees/feature/CLAUDE.md', same)
    put('Projects/epoxy-worktrees/feature/plans/next.md', '# Next\nShip the quote form, then the gallery.')

    const candidates = await projectDocsIngester(projects).list()
    expect(candidates.map((c) => c.path.slice(projects.length)).sort()).toEqual([
      '/Epoxy/CLAUDE.md',
      '/Epoxy/plans/next.md',
      '/epoxy-worktrees/feature/plans/next.md'
    ])
    const titles = (await loadAll(candidates)).map((doc) => doc.title).sort()
    expect(titles).toEqual(['Epoxy rules (Epoxy/CLAUDE.md)', 'Next (Epoxy/next.md)', 'Next (feature/next.md)'])
  })
})

describe('Claude conversations', () => {
  it('keeps user and assistant text only, with the project from cwd', async () => {
    const projects = join(root, 'Projects')
    const cwd = join(projects, 'epoxyitright')
    put(
      'claude/-x-epoxyitright/s1.jsonl',
      jsonl([
        { type: 'user', cwd, timestamp: '2026-11-22T10:00:00Z', message: { role: 'user', content: 'Fix the quote form<system-reminder>hidden harness text</system-reminder>' } },
        { type: 'assistant', cwd, timestamp: '2026-11-22T10:01:00Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'private thought' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } },
        { type: 'user', cwd, timestamp: '2026-11-22T10:01:05Z', message: { role: 'user', content: [{ type: 'tool_result', content: [{ type: 'text', text: 'TOOL OUTPUT LINE' }] }] } },
        { type: 'assistant', cwd, timestamp: '2026-11-22T10:02:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'The form now validates phone numbers.' }] } },
        { type: 'user', isMeta: true, cwd, message: { role: 'user', content: 'meta caveat' } },
        { type: 'user', cwd, message: { role: 'user', content: '<command-name>/clear</command-name>' } },
        { type: 'ai-title', aiTitle: 'Quote form validation', sessionId: 's1' },
        '{"type":"user", torn line'
      ])
    )
    const [doc] = await loadAll(await claudeConversationsIngester(join(root, 'claude'), projects).list())
    expect(doc.project).toBe('epoxyitright')
    expect(doc.title).toBe('Quote form validation')
    const text = allText(doc)
    expect(text).toContain('User: Fix the quote form')
    expect(text).toContain('Claude: The form now validates phone numbers.')
    for (const excluded of ['hidden harness', 'private thought', 'TOOL OUTPUT', 'meta caveat', '/clear']) {
      expect(text).not.toContain(excluded)
    }
    expect(doc.sections[0].at).toBe(Date.parse('2026-11-22T10:00:00Z'))
    // Counted for the classifier; the tool line itself is never stored.
    expect(doc.signals).toEqual({ toolCalls: 1, edits: 0, gitWrites: 0 })
  })
})

describe('Codex conversations', () => {
  it('keeps user and assistant messages, not injected context or tools', async () => {
    put(
      'codex/2026/11/05/rollout-a.jsonl',
      jsonl([
        { type: 'session_meta', payload: { cwd: '/elsewhere/Verlo' } },
        { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'DEV RULES' }] } },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } },
        { type: 'response_item', timestamp: '2026-11-05T16:02:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Rename the pricing page' }] } },
        { type: 'response_item', payload: { type: 'function_call_output', output: 'TOOL RESULT' } },
        { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Renamed to Plans.' }] } }
      ])
    )
    const [doc] = await loadAll(await codexConversationsIngester(join(root, 'codex'), join(root, 'P')).list())
    expect(doc.project).toBe('Verlo')
    expect(doc.title).toBe('Rename the pricing page')
    expect(allText(doc)).toBe('User: Rename the pricing page\nCodex: Renamed to Plans.')
    expect(doc.signals).toEqual({ toolCalls: 0, edits: 0, gitWrites: 0 })
  })
})

describe('ADAM', () => {
  it('reads the thread file and Hermes sessions, message text only', async () => {
    const thread = put(
      'userData/adam-thread.json',
      JSON.stringify([
        { id: '1', role: 'user', text: 'What is on the Board?' },
        { id: '2', role: 'assistant', text: 'Three cards are running.' },
        { id: '3', role: 'system', text: 'system note' }
      ])
    )
    const statePath = join(root, 'hermes-state.db')
    const db = new SyncDatabase(statePath)
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT);
      CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL,
        tool_calls TEXT, tool_name TEXT);
      INSERT INTO sessions VALUES ('h1', 'Morning plan');
      INSERT INTO messages (session_id, role, content, timestamp, tool_calls, tool_name) VALUES
        ('h1', 'user', 'Plan my morning', 1795400000, NULL, NULL),
        ('h1', 'assistant', '', 1795400001, '[{"command": "git commit -m plan"}]', NULL),
        ('h1', 'tool', 'TOOL DUMP', 1795400002, NULL, 'write_file'),
        ('h1', 'assistant', 'Start with the Epoxy quotes.', 1795400003, NULL, NULL);`)
    db.close()

    const candidates = await adamIngester({ threadFile: thread, hermesStateDb: statePath }).list()
    expect(candidates.map((c) => c.key).sort()).toEqual([`adam:hermes:h1`, `adam:thread:${thread}`])
    const hermes = candidates.find((c) => c.key === 'adam:hermes:h1')!
    expect(hermes.mtimeMs).toBe(1795400003 * 1000)
    const docs = await loadAll(candidates)
    const session = docs.find((doc) => doc.title === 'Morning plan')!
    expect(allText(session)).toBe('Carson: Plan my morning\nADAM: Start with the Epoxy quotes.')
    expect(session.signals).toEqual({ toolCalls: 1, edits: 1, gitWrites: 1 })
    const threadDoc = docs.find((doc) => doc.title === 'ADAM thread in Dobius+')!
    expect(allText(threadDoc)).toBe('Carson: What is on the Board?\nADAM: Three cards are running.')
  })

  it('lists nothing when the files are missing', async () => {
    expect(await adamIngester({ threadFile: join(root, 'no.json'), hermesStateDb: join(root, 'no.db') }).list()).toEqual([])
  })
})

describe('Obsidian', () => {
  it('reads markdown with the top folder as project, skipping .obsidian and secret notes', async () => {
    put('vault/AI Research/Carson.md', '# Carson\nRuns Dobius.')
    put('vault/Inbox.md', 'loose note')
    put('vault/.obsidian/workspace.md', 'settings')
    put('vault/Private/passwords.md', 'p')
    const docs = await loadAll(await obsidianIngester(join(root, 'vault')).list())
    expect(docs.map((doc) => [doc.project, doc.title]).sort()).toEqual([
      ['AI Research', 'Carson (Carson.md)'],
      ['Obsidian', 'Inbox.md']
    ])
  })
})

describe('symlinks and folder case', () => {
  it('reads nothing through a symlinked root into a vendor folder', async () => {
    put('repo/vendor/pkg/README.md', '# vendored')
    symlinkSync(join(root, 'repo/vendor'), join(root, 'vault-link'))
    expect(await obsidianIngester(join(root, 'vault-link')).list()).toEqual([])
  })

  it('skips symlinked files and folders named Vendor or NODE_MODULES', async () => {
    put('outside/secret-notes.md', 'outside the vault')
    put('vault/Keep.md', 'kept')
    put('vault/Vendor/a.md', 'vendored')
    put('vault/NODE_MODULES/b.md', 'deps')
    symlinkSync(join(root, 'outside/secret-notes.md'), join(root, 'vault/Linked.md'))
    const candidates = await obsidianIngester(join(root, 'vault')).list()
    expect(candidates.map((c) => c.path.slice(root.length))).toEqual(['/vault/Keep.md'])
  })

  it('refuses a file swapped for a symlink after listing', async () => {
    put('vault/Note.md', 'real note')
    put('outside/other.md', 'not in the vault')
    const [candidate] = await obsidianIngester(join(root, 'vault')).list()
    rmSync(candidate.path)
    symlinkSync(join(root, 'outside/other.md'), candidate.path)
    expect(await candidate.load()).toBeNull()
  })
})

describe('bounded transcript lines', () => {
  it('skips an oversized line without buffering it and keeps the others', async () => {
    const file = put('big.jsonl', `first\n${'x'.repeat(3_000_000)}\nlast`)
    const lines: string[] = []
    for await (const line of boundedLines(file, 1_000_000)) {
      lines.push(line)
    }
    expect(lines).toEqual(['first', 'last'])
  })
})

describe('dedupe size limit', () => {
  it('never hashes a file over the 2 MB limit, and drops it', async () => {
    const big = 'y'.repeat(MAX_FILE_BYTES + 10)
    const a = put('main/plans/export.md', big)
    const b = put('wt/plans/export.md', big)
    const c = put('main/plans/small.md', 'same')
    const d = put('wt/plans/small.md', 'same')
    const main = { root: join(root, 'main'), common: '/repo/.git', linked: false }
    const wt = { root: join(root, 'wt'), common: '/repo/.git', linked: true }
    const hasher = vi.fn(streamHash)
    const kept = await dedupeAcrossCheckouts(
      [
        { checkout: main, path: a },
        { checkout: wt, path: b },
        { checkout: main, path: c },
        { checkout: wt, path: d }
      ],
      hasher
    )
    expect(kept.map((file) => file.path)).toEqual([c])
    expect(hasher.mock.calls.map(([path]) => path).sort()).toEqual([c, d].sort())
  })
})
