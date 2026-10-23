import { describe, expect, it } from 'vitest'
import type { MarkdownDocument } from '../../../../../shared/types'
import { collectMarkdownLinks, layoutMarkdownLinkGraph } from './markdown-link-graph'

const doc = (relativePath: string): MarkdownDocument => {
  const basename = relativePath.split('/').pop()!
  return {
    filePath: `/repo/${relativePath}`,
    relativePath,
    basename,
    name: basename.replace(/\.md$/, '')
  }
}

const docs = [doc('README.md'), doc('docs/guide.md'), doc('docs/api.md'), doc('notes/solo.md')]

describe('collectMarkdownLinks', () => {
  it('resolves wiki-links and relative links, de-duplicated, without self-links', () => {
    const contents = new Map([
      ['README.md', 'See [[guide]] and [the guide](docs/guide.md) and [[README]].'],
      ['docs/guide.md', 'Up: [home](../README.md#intro) · [api](./api.md "API") · [[missing]]'],
      ['docs/api.md', 'External [site](https://example.com/x.md) only.']
    ])
    expect(collectMarkdownLinks(docs, contents)).toEqual([
      { from: 'README.md', to: 'docs/guide.md' },
      { from: 'docs/guide.md', to: 'README.md' },
      { from: 'docs/guide.md', to: 'docs/api.md' }
    ])
  })

  it('ignores links that climb above the repo root', () => {
    const contents = new Map([['README.md', '[x](../../outside.md)']])
    expect(collectMarkdownLinks(docs, contents)).toEqual([])
  })
})

describe('layoutMarkdownLinkGraph', () => {
  it('draws only linked docs, hub first, and counts the rest', () => {
    const graph = layoutMarkdownLinkGraph(docs, [
      { from: 'README.md', to: 'docs/guide.md' },
      { from: 'docs/guide.md', to: 'docs/api.md' }
    ])
    expect(graph.nodes.map((n) => n.relativePath)).toEqual([
      'docs/guide.md',
      'docs/api.md',
      'README.md'
    ])
    expect(graph.unlinkedCount).toBe(1)
    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.x).toBeLessThanOrEqual(graph.size)
    }
  })
})
