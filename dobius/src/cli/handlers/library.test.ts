import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch'
import {
  isCommandGroup,
  normalizeCommandPositionals,
  parseArgs,
  validateCommandAndFlags
} from '../args'
import { COMMAND_SPECS } from '../specs'
import { describeHit, formatLibrarySearch, formatLibraryStatus, LIBRARY_HANDLERS } from './library'

let logged: string[] = []

beforeEach(() => {
  logged = []
  vi.restoreAllMocks()
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logged.push(line)
  })
})

async function run(argv: string[], result: unknown, json = false) {
  const parsed = normalizeCommandPositionals(COMMAND_SPECS, parseArgs(argv))
  validateCommandAndFlags(COMMAND_SPECS, parsed)
  const handler = LIBRARY_HANDLERS[parsed.commandPath.join(' ')]
  expect(handler, `no handler for ${parsed.commandPath.join(' ')}`).toBeDefined()
  const call = vi.fn(async () => ({ id: 'r', ok: true, result }))
  await handler({ flags: parsed.flags, client: { call }, cwd: '/', json } as unknown as HandlerContext)
  return call
}

const hit = {
  source: 'claude' as const,
  project: 'epoxyitright',
  title: 'Quote form \u001b[31mvalidation',
  path: '/Users/x/.claude/projects/p/s.jsonl',
  when: '2026-11-22T15:00:00.000Z',
  snippet: 'The form now validates phone numbers.'
}

describe('library CLI', () => {
  it('has a handler for every library spec', () => {
    const specs = COMMAND_SPECS.filter((spec) => spec.path[0] === 'library')
    expect(specs.map((spec) => spec.path.join(' ')).sort()).toEqual(Object.keys(LIBRARY_HANDLERS).sort())
    expect(isCommandGroup(['library'])).toBe(true)
  })

  it('search takes the query as a positional and passes filters', async () => {
    const call = await run(
      ['library', 'search', 'quote form', '--project', 'epoxy', '--source', 'Claude', '--limit', '3'],
      { results: [hit] }
    )
    expect(call).toHaveBeenCalledWith('library.search', {
      query: 'quote form',
      project: 'epoxy',
      source: 'claude',
      limit: 3
    })
    expect(logged.at(-1)).toContain('1. Claude conversation in epoxyitright on Nov 22, 2026: Quote form validation')
    expect(logged.at(-1)).not.toContain('\u001b')
  })

  it('refuses an unknown source before calling the app', async () => {
    await expect(run(['library', 'search', 'x', '--source', 'gmail'], { results: [] })).rejects.toThrow(
      /Source must be one of/
    )
  })

  it('prints JSON with --json', async () => {
    await run(['library', 'search', 'quote', '--json'], { results: [hit] }, true)
    expect(JSON.parse(logged.at(-1)!)).toMatchObject({ result: { results: [{ title: hit.title }] } })
  })

  it('formats empty results, hits and status', () => {
    expect(formatLibrarySearch({ results: [] })).toBe('Nothing in the library matches that.')
    expect(describeHit({ ...hit, source: 'project', project: null })).toBe('Project notes on Nov 22, 2026')
    const text = formatLibraryStatus({
      fullTextSearch: true,
      sizeBytes: 52_428_800,
      capBytes: 419_430_400,
      refreshing: false,
      lastRefresh: {
        finishedAt: '2026-11-22T15:00:00.000Z',
        durationMs: 42_000,
        indexed: 10,
        unchanged: 90,
        removed: 1,
        evicted: 0,
        compacted: 4,
        droppedChunks: 2,
        stopped: 'less than 2 GB of disk would be left free',
        errors: []
      },
      sources: [{ source: 'claude', documents: 3, chunks: 40, textBytes: 1_048_576 }],
      classes: [
        { kind: 'work-done', documents: 2, compacted: 1 },
        { kind: 'chat', documents: 1, compacted: 0 }
      ]
    })
    expect(text).toContain('Library: 50.0 MB of 400.0 MB.')
    expect(text).toContain('Claude conversations: 3 (40 passages, 1.0 MB of text)')
    expect(text).toContain('By kind: Finished work 2 (1 compacted), Chats 1.')
    expect(text).toContain('10 read, 90 unchanged, 1 removed, 4 compacted, 0 dropped for space.')
    expect(text).toContain('It stopped early: less than 2 GB of disk would be left free.')
    expect(formatLibraryStatus({ fullTextSearch: false, sizeBytes: 0, capBytes: 1, refreshing: true, lastRefresh: null, sources: [] })).toContain(
      'Not refreshed yet'
    )
  })
})
