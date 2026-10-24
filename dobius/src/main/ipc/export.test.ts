import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }
}))

import { buildExportPrintOverrides } from './export'

describe('buildExportPrintOverrides', () => {
  it('keeps the historical defaults when nothing is asked for', () => {
    expect(buildExportPrintOverrides({})).toEqual({})
  })

  it('maps US Letter and A4 to paper sizes in inches', () => {
    expect(buildExportPrintOverrides({ pageSize: 'Letter' }).pageSize).toEqual({
      width: 8.5,
      height: 11
    })
    expect(buildExportPrintOverrides({ pageSize: 'A4' }).pageSize).toEqual({
      width: 8.27,
      height: 11.69
    })
  })

  it('adds a page-number footer with room for it in the margin', () => {
    const options = buildExportPrintOverrides({ pageSize: 'A4', pageNumbers: true })
    expect(options.displayHeaderFooter).toBe(true)
    expect(options.footerTemplate).toContain('class="pageNumber"')
    expect(options.footerTemplate).toContain('class="totalPages"')
    expect(options.margins).toMatchObject({ marginType: 'custom', bottom: 0.8 })
  })

  it('ignores an unknown page size from an untrusted renderer', () => {
    expect(buildExportPrintOverrides({ pageSize: 'Tabloid' as 'A4' })).toEqual({})
  })
})
