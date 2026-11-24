// Round 5: class each transcript (finished work, open work, chat), compact old
// work, and give up space in class order. Synthetic transcripts and secrets only.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DocClass } from './library-classify'
import { addClaudeSignals, addCodexSignals, classifyDocument, emptySignals } from './library-classify'
import { COMPACT_AFTER_MS, COMPACT_MAX_CHARS, compactText, nextShrinkStep } from './library-compact'
import { refreshLibrary, walReserve } from './library-indexer'
import { classCounts, searchLibrary } from './library-search'
import { LibraryStore } from './library-store'
import type { LibraryCandidate, LibraryDocument, LibrarySource } from './library-types'

const FAKE_KEY = `sk-proj-${'Q1w2E3r4'.repeat(5)}`

function transcript(turns: string[], signals = emptySignals()): LibraryDocument {
  return { project: 'Epoxy', title: 'Session', sections: turns.map((text, at) => ({ text, at })), signals }
}

describe('classifyDocument', () => {
  it('finished work: edits plus a git commit, or a final "done"', () => {
    const signals = emptySignals()
    addClaudeSignals(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: {} }] } }),
      signals
    )
    addClaudeSignals(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "fix form"' } }] }
      }),
      signals
    )
    expect(signals).toEqual({ toolCalls: 2, edits: 1, gitWrites: 1 })
    expect(classifyDocument('claude', transcript(['User: Fix the quote form', 'Claude: Looking.'], signals))).toBe(
      'work-done'
    )
    expect(
      classifyDocument('adam', transcript(['Carson: Build the gallery page', 'ADAM: The gallery page is done.']))
    ).toBe('work-done')
  })

  it('open work: an objective with no finished signal', () => {
    const signals = emptySignals()
    addCodexSignals(JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'exec' } }), signals)
    addCodexSignals(
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', input: '*** Begin Patch' } }),
      signals
    )
    expect(signals).toEqual({ toolCalls: 2, edits: 1, gitWrites: 0 })
    expect(
      classifyDocument('codex', transcript(['User: Rename the pricing page', 'Codex: Halfway through.'], signals))
    ).toBe('work-open')
    expect(classifyDocument('claude', transcript(['User: Add dark mode', 'Claude: Which screens first?']))).toBe(
      'work-open'
    )
  })

  it('chat: questions and answers, no edits or commits', () => {
    const signals = { toolCalls: 2, edits: 0, gitWrites: 0 }
    expect(
      classifyDocument('claude', transcript(['User: What does WAL mode mean?', 'Claude: A write-ahead log.'], signals))
    ).toBe('chat')
    expect(classifyDocument('project', transcript(['User: Fix it', 'Claude: done']))).toBe('reference')
  })
})

describe('compactText', () => {
  const turns = [
    'User: Build the quote form for Epoxy.\n\nClaude: On it.',
    'User: Use the blue accent.\n\nClaude: We decided to keep the phone check client-side.\nSome filler line.',
    `Claude: Never send the form without a phone number.\n\n${'Claude: filler. '.repeat(400)}`,
    'Claude: Committed 3f9a2c1d and opened PR #42. The quote form is done.'
  ]

  it('keeps the first ask, the final answer, the decision lines and the refs', () => {
    const text = compactText('Quote form', turns)
    expect(text.length).toBeLessThanOrEqual(COMPACT_MAX_CHARS)
    expect(text).toContain('Quote form')
    expect(text).toContain('Build the quote form for Epoxy.')
    expect(text).toContain('The quote form is done.')
    expect(text).toContain('We decided to keep the phone check client-side.')
    expect(text).toContain('Never send the form without a phone number.')
    expect(text).toContain('PR #42')
    expect(text).toContain('3f9a2c1d')
    expect(text).not.toContain('Some filler line')
  })

  it('scrubs secrets out of the compact text', () => {
    const text = compactText('Keys', [
      `User: Set up the API.\n\nClaude: We decided the key is ${FAKE_KEY} for now.`,
      `Claude: Done. Always rotate ${FAKE_KEY}.`
    ])
    expect(text).not.toContain(FAKE_KEY)
    expect(text).not.toContain('Q1w2E3r4')
  })
})

describe('class order and compaction in the store', () => {
  let dir: string
  let store: LibraryStore
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'library-classify-')))
    store = new LibraryStore(join(dir, 'library.sqlite'))
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('drops chats first, compacts every work conversation before dropping one, notes last', () => {
    const docs: [string, LibrarySource, DocClass, number][] = [
      ['note-old', 'project', 'reference', 1],
      ['done-old', 'claude', 'work-done', 2],
      ['open-new', 'codex', 'work-open', 9],
      ['chat-new', 'claude', 'chat', 8],
      ['open-old', 'claude', 'work-open', 3],
      ['chat-old', 'adam', 'chat', 4]
    ]
    const ids = new Map<number, string>()
    for (const [key, source, kind, mtimeMs] of docs) {
      const id = store.putDoc({ key, source, project: null, path: `/${key}`, title: key, mtimeMs, size: 1, kind }, [
        { text: `User: ask ${key}\n\nClaude: answer ${key}`, at: mtimeMs }
      ])
      ids.set(id, key)
    }
    const steps: string[] = []
    for (let step = nextShrinkStep(store); step; step = nextShrinkStep(store)) {
      steps.push(`${step.action} ${ids.get(step.id)}`)
      if (step.action === 'evict') {
        store.evictDoc(step.id)
      } else {
        store.replaceWithCompact(step.id, ids.get(step.id)!, `Compacted conversation: ${ids.get(step.id)}`)
      }
    }
    expect(steps).toEqual([
      'evict chat-old',
      'evict chat-new',
      'compact open-old',
      'compact open-new',
      'compact done-old',
      'evict open-old',
      'evict open-new',
      'evict done-old',
      'evict note-old'
    ])
  })

  const fast = { yieldNow: () => Promise.resolve(), freeBytes: async () => 1e12 }
  const words = (seed: number, count: number): string =>
    Array.from({ length: count }, (_, i) => `w${seed}x${i}`).join(' ')

  it('reclaims FTS space after compacting, so the cap holds (was 926 kB against 400 kB)', async () => {
    const cap = 400 * 1024
    const docs = Array.from({ length: 20 }, (_, n) => ({
      key: `work-${n}`,
      source: 'claude' as const,
      path: `/work-${n}.jsonl`,
      // Recent, so nothing is compacted at read time; only the cap compacts.
      mtimeMs: Date.now() - 60_000 + n,
      size: 1,
      load: async () =>
        transcript([`User: Fix part ${n}`, `Claude: ${words(n, 4000)}`, 'Claude: Fixed and committed.'], {
          toolCalls: 3,
          edits: 1,
          gitWrites: 1
        })
    }))
    const ingesters = [{ source: 'claude' as const, list: async () => docs }]
    await refreshLibrary(store, ingesters, { capBytes: 400 * 1024 * 1024, ...fast })
    // Same files, now over a small cap: only the shrink runs.
    const report = await refreshLibrary(store, ingesters, { capBytes: cap, ...fast })
    expect(report.unchanged).toBe(20)
    expect(store.pageBytes()).toBeLessThanOrEqual(cap - walReserve(cap))
    // Compacting alone should make room: done work outlives the space it gave back.
    expect(classCounts(store).find((entry) => entry.kind === 'work-done')?.documents).toBeGreaterThan(0)
  })

  it('reads an older small note when it still fits, after a larger newer one was evicted', async () => {
    const cap = 400 * 1024
    const note = (key: string, mtimeMs: number, text: string): LibraryCandidate => ({
      key,
      source: 'project',
      path: `/${key}.md`,
      mtimeMs,
      size: text.length,
      load: async () => ({ project: 'P', title: key, sections: [{ text, at: mtimeMs }] })
    })
    const candidates = [
      note('mid', 2000, words(1, 20_000)),
      note('big', 3000, words(2, 60_000)),
      note('small', 1000, 'The small old note about the blue accent.')
    ]
    await refreshLibrary(store, [{ source: 'project', list: async () => candidates }], { capBytes: cap, ...fast })
    expect(store.getDoc('small')?.evicted).toBe(false)
    expect(searchLibrary(store, { query: 'blue accent' }).map((hit) => hit.title)).toEqual(['small'])
  })

  it('stores old work compacted and still searchable, and counts each class', async () => {
    const now = Date.now()
    const old = now - COMPACT_AFTER_MS - 86_400_000
    const work = transcript(
      [
        'User: Fix the gallery upload',
        `Claude: ${'Checked the upload path. '.repeat(400)}`,
        'Claude: Fixed and merged. The plan is to keep uploads under 10 MB.'
      ],
      { toolCalls: 6, edits: 2, gitWrites: 1 }
    )
    const chat = transcript(['User: What is a worktree?', `Claude: ${'A second checkout. '.repeat(300)}`])
    const recent = transcript(['User: Add a footer', 'Claude: Which links?'], { toolCalls: 1, edits: 1, gitWrites: 0 })
    const report = await refreshLibrary(
      store,
      [
        {
          source: 'claude',
          list: async () =>
            (
              [
                ['work', work, old],
                ['chat', chat, old],
                ['recent', recent, now]
              ] as const
            ).map(([key, doc, mtimeMs]) => ({ key, source: 'claude', path: `/${key}.jsonl`, mtimeMs, size: 1, load: async () => doc }))
        }
      ],
      { capBytes: 400 * 1024 * 1024, yieldNow: () => Promise.resolve(), freeBytes: async () => 1e12 }
    )
    expect(report.compacted).toBe(1)
    const counts = Object.fromEntries(classCounts(store).map((entry) => [entry.kind, entry]))
    expect(counts['work-done']).toEqual({ kind: 'work-done', documents: 1, compacted: 1 })
    expect(counts['work-open']).toEqual({ kind: 'work-open', documents: 1, compacted: 0 })
    expect(counts.chat).toEqual({ kind: 'chat', documents: 1, compacted: 0 })
    const chunks = store.db
      .prepare("SELECT c.text FROM chunks c JOIN docs d ON d.id = c.doc_id WHERE d.kind = 'work-done'")
      .all() as { text: string }[]
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text.length).toBeLessThanOrEqual(COMPACT_MAX_CHARS)
    expect(searchLibrary(store, { query: 'uploads under 10 MB' }).map((hit) => hit.path)).toEqual(['/work.jsonl'])
  })
})
