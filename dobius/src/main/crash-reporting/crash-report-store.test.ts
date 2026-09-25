import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CrashReportStore } from './crash-report-store'
import type { CrashReportCreateInput } from '../../shared/crash-reporting'

const tempDirs: string[] = []

async function createStore(): Promise<{ store: CrashReportStore; filePath: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dobius-crash-reports-'))
  tempDirs.push(dir)
  const filePath = path.join(dir, 'crash-reports.json')
  return { store: new CrashReportStore(filePath), filePath }
}

function input(reason = 'crashed'): CrashReportCreateInput {
  return {
    source: 'renderer',
    processType: 'renderer',
    reason,
    exitCode: 5,
    appVersion: '1.0.0',
    platform: process.platform,
    osRelease: 'test',
    arch: process.arch,
    electronVersion: '41',
    chromeVersion: '141',
    details: { path: '/Users/alice/project', code: 5 },
    breadcrumbs: [
      {
        createdAt: '2026-05-16T01:00:00.000Z',
        name: 'workspace_opened',
        data: { path: '/Users/alice/project', ssh: false }
      }
    ]
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('CrashReportStore', () => {
  it('records sanitized pending reports and returns the latest pending report', async () => {
    const { store } = await createStore()

    const report = await store.record(input())

    expect(report.status).toBe('pending')
    expect(report.details.path).toBe('[redacted-path]')
    expect(report.breadcrumbs).toEqual([
      {
        createdAt: '2026-05-16T01:00:00.000Z',
        name: 'workspace_opened',
        data: { path: '[redacted-path]', ssh: false }
      }
    ])
    await expect(store.getLatestPending()).resolves.toMatchObject({ id: report.id })
  })

  it('caps reports to the newest five', async () => {
    const { store } = await createStore()

    for (let index = 0; index < 7; index += 1) {
      await store.record(input(`crashed-${index}`))
    }

    const reports = await store.listRecent()
    expect(reports).toHaveLength(5)
    expect(reports[0].reason).toBe('crashed-6')
    expect(reports[4].reason).toBe('crashed-2')
  })

  it('recovers corrupt JSON as an empty report list', async () => {
    const { store, filePath } = await createStore()
    await fs.writeFile(filePath, '{ nope', 'utf8')

    await expect(store.listRecent()).resolves.toEqual([])
  })

  it('never records over an unreadable file and recovers once it is repaired (BUILD-009B)', async () => {
    const { store, filePath } = await createStore()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const bad of ['{ nope', '{"reports": 5}', '[]']) {
      await fs.writeFile(filePath, bad, 'utf8')
      const before = await fs.stat(filePath)

      await expect(store.getLatestPending()).resolves.toBeNull()
      await expect(store.record(input())).rejects.toThrow(/unreadable/)
      await expect(store.dismiss('missing')).rejects.toThrow(/unreadable/)

      await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(bad)
      expect((await fs.stat(filePath)).mtimeMs).toBe(before.mtimeMs)
    }
    const names = await fs.readdir(path.dirname(filePath))
    expect(names.filter((name) => name.endsWith('.tmp'))).toEqual([])
    expect(names.filter((name) => name.startsWith('crash-reports.json.unreadable-'))).toHaveLength(3)

    await fs.writeFile(filePath, JSON.stringify({ reports: [] }), 'utf8')
    await expect(store.record(input())).resolves.toMatchObject({ status: 'pending' })
    await vi.waitFor(async () =>
      expect(JSON.parse(await fs.readFile(filePath, 'utf8')).reports).toHaveLength(1)
    )
  })

  it('a missing file still records normally', async () => {
    const { store, filePath } = await createStore()
    await store.record(input())
    expect(JSON.parse(await fs.readFile(filePath, 'utf8')).reports).toHaveLength(1)
  })

  it('allows a pending report to reach one terminal status only', async () => {
    const { store } = await createStore()
    const report = await store.record(input())

    await expect(store.dismiss(report.id)).resolves.toMatchObject({ status: 'dismissed' })
    await expect(store.markSent(report.id)).resolves.toMatchObject({ status: 'dismissed' })
  })

  it('dismisses sibling pending records from the same Electron crash event', async () => {
    const { store } = await createStore()
    await store.record(input())
    await store.record(input())
    const renderer = await store.record(input())

    await expect(store.dismiss(renderer.id)).resolves.toMatchObject({ status: 'dismissed' })
    await expect(store.getLatestPending()).resolves.toBeNull()
  })

  it('dismisses sibling pending records after one crash report is sent', async () => {
    const { store } = await createStore()
    await store.record(input())
    await store.record(input())
    const renderer = await store.record(input())

    await expect(store.markSent(renderer.id)).resolves.toMatchObject({ status: 'sent' })

    const reports = await store.listRecent()
    expect(reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: renderer.id, status: 'sent' }),
        expect.objectContaining({ status: 'dismissed' }),
        expect.objectContaining({ status: 'dismissed' })
      ])
    )
    await expect(store.getLatestPending()).resolves.toBeNull()
  })

  it('persists a submitted dismissed report as sent', async () => {
    const { store, filePath } = await createStore()
    const report = await store.record(input())

    await expect(store.dismiss(report.id)).resolves.toMatchObject({ status: 'dismissed' })
    await expect(store.markDismissedSent(report.id)).resolves.toMatchObject({ status: 'sent' })

    const reloaded = new CrashReportStore(filePath)
    await expect(reloaded.getById(report.id)).resolves.toMatchObject({ status: 'sent' })
  })

  it('serializes concurrent writes', async () => {
    const { store } = await createStore()

    await Promise.all(Array.from({ length: 5 }, (_, index) => store.record(input(`oom-${index}`))))

    await expect(store.listRecent()).resolves.toHaveLength(5)
  })
})
