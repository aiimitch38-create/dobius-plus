import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AdamThreadRow } from '../../shared/speech-types'
import { ADAM_THREAD_CAP, AdamThreadStore, adamThreadRowOf } from './adam-thread-store'

let directory: string
let file: string
let announced: AdamThreadRow[][]
const open = (): AdamThreadStore => new AdamThreadStore(file, (rows) => announced.push(rows))
const row = (id: string, text = id): AdamThreadRow => ({ id, role: 'user', text })
const texts = (rows: AdamThreadRow[]): string[] => rows.map((r) => r.text)

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'adam-thread-'))
  file = join(directory, 'adam-thread.json')
  announced = []
})
afterEach(() => rm(directory, { recursive: true, force: true }))

describe('AdamThreadStore: main owns the one thread', () => {
  it('keeps both rows when two windows append at the same moment', async () => {
    const store = open()
    await Promise.all([store.append(row('a')), store.append(row('b'))])
    expect(texts(await store.get()).sort()).toEqual(['a', 'b'])
    // On disk too, and each window was sent the full thread.
    expect(texts(await open().get()).sort()).toEqual(['a', 'b'])
    expect(texts(announced.at(-1)!).sort()).toEqual(['a', 'b'])
  })

  it('adds a row once when it is sent twice', async () => {
    const store = open()
    await store.append(row('v1:asked', 'status?'))
    await store.append(row('v1:asked', 'status?'))
    expect(texts(await store.get())).toEqual(['status?'])
  })

  it('keeps only the latest rows, in memory and on disk', async () => {
    const store = open()
    for (let i = 0; i < ADAM_THREAD_CAP + 5; i += 1) {
      await store.append(row(String(i)))
    }
    expect(await store.get()).toHaveLength(ADAM_THREAD_CAP)
    expect((await store.get())[0].id).toBe('5')
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveLength(ADAM_THREAD_CAP)
  })

  it('clears for every window and survives a corrupt file', async () => {
    await writeFile(file, '{not json')
    const store = open()
    expect(await store.get()).toEqual([])
    await store.append(row('a'))
    await store.clear()
    expect(announced.at(-1)).toEqual([])
    expect(await open().get()).toEqual([])
  })
})

describe('adamThreadRowOf', () => {
  it('accepts a plain row with its extras and refuses anything else', () => {
    expect(adamThreadRowOf({ id: 'a', role: 'assistant', text: 'hi', voice: true })).toEqual({
      id: 'a',
      role: 'assistant',
      text: 'hi',
      voice: true
    })
    for (const bad of [
      null,
      'row',
      [],
      { id: '', role: 'user', text: 'x' },
      { id: 'a', role: 'root', text: 'x' },
      { id: 'a', role: 'user' },
      { id: 'a', role: 'user', text: 'x'.repeat(40_000) }
    ]) {
      expect(adamThreadRowOf(bad)).toBeNull()
    }
  })
})
