// @vitest-environment happy-dom

// #122 F8: Settings > Editor "Markdown Review Notes" must actually switch the
// rich-editor review tools. Off hides note controls, the saved-note rail and
// agent handoff actions; the notes stay stored on the worktree.

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { DiffComment, GlobalSettings } from '../../../../shared/types'
import { useRichMarkdownReviewData } from './useRichMarkdownReviewData'

const initialAppState = useAppStore.getInitialState()

const NOTE: DiffComment = {
  id: 'note-1',
  worktreeId: 'wt-1',
  filePath: 'docs/plan.md',
  source: 'markdown',
  lineNumber: 3,
  body: 'Tighten this section',
  createdAt: 1,
  side: 'modified'
}

type ReviewData = ReturnType<typeof useRichMarkdownReviewData>

const roots: Root[] = []
let latest: ReviewData | null = null

function HookProbe(): null {
  latest = useRichMarkdownReviewData({
    allDiffComments: [NOTE],
    filePath: '/repo/docs/plan.md',
    markdownAnnotationsEnabled: true,
    markdownReviewContent: '# Plan\n\nBody\n',
    worktreeRoot: '/repo'
  })
  return null
}

async function renderProbe(): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(createElement(HookProbe))
  })
}

function setReviewToolsSetting(value: boolean | undefined): void {
  useAppStore.setState({
    settings: { markdownReviewToolsEnabled: value } as unknown as GlobalSettings
  })
}

describe('useRichMarkdownReviewData — Markdown Review Notes setting', () => {
  beforeEach(() => {
    useAppStore.setState(initialAppState, true)
    latest = null
  })
  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount())
    }
    document.body.replaceChildren()
    useAppStore.setState(initialAppState, true)
  })

  it('shows review tools and saved notes when the setting is on', async () => {
    setReviewToolsSetting(true)
    await renderProbe()
    expect(latest?.canAnnotateRichMarkdown).toBe(true)
    expect(latest?.markdownComments).toEqual([NOTE])
    expect(latest?.unsentMarkdownReviewScope[0]?.notes).toHaveLength(1)
  })

  it('hides note controls, the notes rail and handoff actions when the setting is off', async () => {
    setReviewToolsSetting(false)
    await renderProbe()
    expect(latest?.canAnnotateRichMarkdown).toBe(false)
    expect(latest?.markdownComments).toEqual([])
    expect(latest?.unsentMarkdownReviewScope[0]?.notes).toHaveLength(0)
  })

  it('applies a live toggle without touching the stored notes', async () => {
    setReviewToolsSetting(true)
    await renderProbe()
    await act(async () => {
      setReviewToolsSetting(false)
    })
    expect(latest?.canAnnotateRichMarkdown).toBe(false)
    expect(latest?.markdownComments).toEqual([])
    expect(NOTE.body).toBe('Tighten this section')
  })

  it('keeps the default (on) while settings are not loaded yet', async () => {
    useAppStore.setState({ settings: null })
    await renderProbe()
    expect(latest?.canAnnotateRichMarkdown).toBe(true)
    expect(latest?.markdownComments).toEqual([NOTE])
  })
})
