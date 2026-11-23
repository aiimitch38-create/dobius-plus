import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openConfinedTranscriptFile } from './transcript-path-guard'

describe('openConfinedTranscriptFile', () => {
  let dir: string | null = null

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true })
      dir = null
    }
  })

  async function setup(): Promise<{ root: string; outside: string }> {
    dir = await mkdtemp(join(tmpdir(), 'transcript-guard-'))
    const root = join(dir, 'projects')
    const outside = join(dir, 'outside')
    await mkdir(join(root, 'p'), { recursive: true })
    await mkdir(outside, { recursive: true })
    return { root, outside }
  }

  it('opens a regular .jsonl file inside a root', async () => {
    const { root } = await setup()
    const path = join(root, 'p', 's.jsonl')
    await writeFile(path, '{}\n')
    const opened = await openConfinedTranscriptFile(path, [root])
    if ('reason' in opened) {
      throw new Error(opened.reason)
    }
    expect(opened.size).toBe(3)
    await opened.handle.close()
  })

  it('refuses files outside the roots, including through ..', async () => {
    const { root, outside } = await setup()
    await writeFile(join(outside, 'secret.jsonl'), 'x')
    await expect(
      openConfinedTranscriptFile(join(outside, 'secret.jsonl'), [root])
    ).resolves.toEqual({ reason: 'transcript path is outside the agent session folders' })
    await expect(
      openConfinedTranscriptFile(join(root, 'p', '..', '..', 'outside', 'secret.jsonl'), [root])
    ).resolves.toEqual({ reason: 'transcript path is outside the agent session folders' })
  })

  it('refuses a symlink inside the root that points outside it', async () => {
    const { root, outside } = await setup()
    await writeFile(join(outside, 'secret.jsonl'), 'x')
    await symlink(join(outside, 'secret.jsonl'), join(root, 'p', 'link.jsonl'))
    await expect(
      openConfinedTranscriptFile(join(root, 'p', 'link.jsonl'), [root])
    ).resolves.toEqual({
      reason: 'transcript path is outside the agent session folders'
    })
  })

  it('refuses non-jsonl paths, relative paths and directories', async () => {
    const { root } = await setup()
    await writeFile(join(root, 'p', 'notes.txt'), 'x')
    await mkdir(join(root, 'p', 'dir.jsonl'))
    await expect(openConfinedTranscriptFile(join(root, 'p', 'notes.txt'), [root])).resolves.toEqual(
      {
        reason: 'transcript path is not an absolute .jsonl path'
      }
    )
    await expect(openConfinedTranscriptFile('p/s.jsonl', [root])).resolves.toEqual({
      reason: 'transcript path is not an absolute .jsonl path'
    })
    await expect(openConfinedTranscriptFile(join(root, 'p', 'dir.jsonl'), [root])).resolves.toEqual(
      {
        reason: 'transcript is not a regular file'
      }
    )
  })

  it('refuses everything when no roots exist', async () => {
    const { root } = await setup()
    const path = join(root, 'p', 's.jsonl')
    await writeFile(path, '{}\n')
    await expect(openConfinedTranscriptFile(path, [])).resolves.toMatchObject({
      reason: 'transcript path is outside the agent session folders'
    })
  })
})
