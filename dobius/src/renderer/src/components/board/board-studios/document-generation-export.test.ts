import { describe, expect, it } from 'vitest'
import {
  anchorHeadings,
  buildDocumentPdfHtml,
  buildTocHtml,
  documentExportBaseName,
  slugifyHeading
} from './document-generation-export'

describe('anchorHeadings', () => {
  it('adds unique ids in document order and strips inline markup from the text', () => {
    const { html, headings } = anchorHeadings(
      '<h1>Intro</h1><p>x</p><h2>Set <code>up</code> &amp; run</h2><h2>Intro</h2><h3 class="x">Intro</h3>'
    )
    expect(headings).toEqual([
      { level: 1, text: 'Intro', id: 'h-intro' },
      { level: 2, text: 'Set up & run', id: 'h-set-up-run' },
      { level: 2, text: 'Intro', id: 'h-intro-2' },
      { level: 3, text: 'Intro', id: 'h-intro-3' }
    ])
    expect(html).toContain('<h2 id="h-set-up-run">Set <code>up</code> &amp; run</h2>')
    expect(html).toContain('<h3 id="h-intro-3">Intro</h3>')
  })

  it('falls back to a generic slug for symbol-only headings', () => {
    expect(slugifyHeading('???')).toBe('section')
    expect(slugifyHeading('Café Déjà vu')).toBe('cafe-deja-vu')
  })
})

describe('buildTocHtml', () => {
  it('indents relative to the shallowest heading and skips deep levels', () => {
    const toc = buildTocHtml([
      { level: 2, text: 'A', id: 'a' },
      { level: 3, text: 'B <b>', id: 'b' },
      { level: 5, text: 'Deep', id: 'd' }
    ])
    expect(toc).toContain('<li class="toc-l0"><a href="#a">A</a></li>')
    expect(toc).toContain('<li class="toc-l1"><a href="#b">B &lt;b&gt;</a></li>')
    expect(toc).not.toContain('Deep')
  })

  it('is empty when there are no headings', () => {
    expect(buildTocHtml([])).toBe('')
  })
})

describe('buildDocumentPdfHtml', () => {
  it('puts a title page, then the TOC, then the anchored body', () => {
    const html = buildDocumentPdfHtml({
      title: 'Plan <v2>',
      meta: ['docs/plan.md'],
      bodyHtml: '<h1>Goals</h1><p>Ship.</p>',
      tocTitle: 'Contents'
    })
    const titleAt = html.indexOf('class="doc-title"')
    const tocAt = html.indexOf('class="doc-toc"')
    const bodyAt = html.indexOf('<h1 id="h-goals">')
    expect(titleAt).toBeGreaterThan(0)
    expect(tocAt).toBeGreaterThan(titleAt)
    expect(bodyAt).toBeGreaterThan(tocAt)
    expect(html).toContain('Plan &lt;v2&gt;')
    expect(html).toContain('<a href="#h-goals">Goals</a>')
    expect(html).toContain("default-src 'none'")
  })

  it('omits the TOC page for a document without headings', () => {
    const html = buildDocumentPdfHtml({
      title: 'Note',
      meta: [],
      bodyHtml: '<p>Just text.</p>',
      tocTitle: 'Contents'
    })
    expect(html).not.toContain('class="doc-toc"')
  })
})

describe('documentExportBaseName', () => {
  it('drops the extension and illegal characters', () => {
    expect(documentExportBaseName('README.md')).toBe('README')
    expect(documentExportBaseName('a:b?.markdown')).toBe('a_b_')
    expect(documentExportBaseName('.md')).toBe('.md')
  })
})
