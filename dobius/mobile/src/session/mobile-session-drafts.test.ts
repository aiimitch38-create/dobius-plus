import { describe, expect, it } from 'vitest'
import { MobileClientSelectionController } from './mobile-client-selection'
import { retainMobileSessionDrafts } from './mobile-session-drafts'

const draft = { id: 'draft', type: 'markdown', isActive: true }
const otherDraft = { id: 'other-draft', type: 'markdown', isActive: false }
const laptop = { id: 'laptop', type: 'terminal', terminal: 'pty-laptop', isActive: true }

describe('phone draft retention with independent selection', () => {
  it('keeps every unsaved draft when the host closes them and preserves the phone choice', async () => {
    const docs = new Map([
      ['draft', { status: 'ready', isDirty: true }],
      ['other-draft', { status: 'ready', isDirty: true }]
    ])
    const tabs = retainMobileSessionDrafts([laptop], [draft, otherDraft], docs, 'draft')
    expect(tabs.map((tab) => tab.id)).toEqual(['draft', 'other-draft', 'laptop'])
    const controller = new MobileClientSelectionController(
      {
        getItem: async () => JSON.stringify({ tabId: 'draft', terminalHandle: null }),
        setItem: async () => {}
      },
      'phone'
    )
    await controller.hydrate()
    expect(controller.reconcile(tabs).tab?.id).toBe('draft')
    const reconnect = retainMobileSessionDrafts([laptop], tabs, docs, 'draft')
    expect(controller.reconcile(reconnect).tab?.id).toBe('draft')
    expect(docs.get('draft')?.isDirty).toBe(true)
  })

  it('drops absent clean/loading documents and never duplicates a published draft', () => {
    const incoming = [draft]
    const docs = new Map([
      ['draft', { status: 'ready', isDirty: true }],
      ['other-draft', { status: 'loading', isDirty: true }],
      ['clean', { status: 'ready', isDirty: false }]
    ])
    expect(
      retainMobileSessionDrafts(
        incoming,
        [
          draft,
          otherDraft,
          {
            id: 'clean',
            type: 'markdown',
            isActive: false
          }
        ],
        docs,
        'draft'
      )
    ).toBe(incoming)
  })

  it('does not preserve a missing terminal or file merely because a stale draft record exists', () => {
    expect(
      retainMobileSessionDrafts(
        [],
        [laptop, { ...draft, type: 'file' }],
        new Map([
          ['laptop', { status: 'ready', isDirty: true }],
          ['draft', { status: 'ready', isDirty: true }]
        ]),
        null
      )
    ).toEqual([])
  })
})
