import { describe, expect, it } from 'vitest'
import type { InteractivePromptCard } from './native-chat-interactive-prompt'
import {
  gateNativeChatComposerSend,
  nativeChatCardComposerPlaceholder
} from './native-chat-card-composer-gate'

// Adapted from Line A #26 (chat-service "own-words answers" and the ChatPane
// send guard): while a card is up a composer send never pastes into the prompt.
const question = (count: number): InteractivePromptCard => ({
  kind: 'question',
  prompt: {
    questions: Array.from({ length: count }, (_, i) => ({
      question: `Question ${i + 1}?`,
      header: '',
      multiSelect: false,
      options: [{ label: 'Yes' }, { label: 'No' }]
    }))
  }
})
const approval: InteractivePromptCard = {
  kind: 'approval',
  approval: { title: 'Allow Bash?', options: [{ label: 'Allow', send: '1' }] }
}
const draft = { text: 'use the staging database', imageCount: 0, isSlashCommand: false }

describe('gateNativeChatComposerSend', () => {
  it('lets a send through when no card is up', () => {
    expect(gateNativeChatComposerSend({ card: null, answering: false, ...draft })).toEqual({
      kind: 'pass'
    })
  })

  it('answers a one-question card with your own words', () => {
    expect(gateNativeChatComposerSend({ card: question(1), answering: false, ...draft })).toEqual(
      { kind: 'answer' }
    )
  })

  it('holds the draft for a permission prompt', () => {
    expect(gateNativeChatComposerSend({ card: approval, answering: false, ...draft })).toEqual({
      kind: 'hold',
      reason: 'pick-option'
    })
  })

  it('holds the draft for a multi-question card', () => {
    expect(gateNativeChatComposerSend({ card: question(2), answering: false, ...draft })).toEqual(
      { kind: 'hold', reason: 'answer-in-card' }
    )
  })

  it('holds a slash command or images instead of sending them as an answer', () => {
    expect(
      gateNativeChatComposerSend({
        card: question(1),
        answering: false,
        ...draft,
        text: '/clear',
        isSlashCommand: true
      })
    ).toEqual({ kind: 'hold', reason: 'answer-in-card' })
    expect(
      gateNativeChatComposerSend({ card: question(1), answering: false, ...draft, imageCount: 1 })
    ).toEqual({ kind: 'hold', reason: 'no-images' })
  })

  it('holds every send while an earlier answer is still going in, card or not', () => {
    expect(gateNativeChatComposerSend({ card: null, answering: true, ...draft })).toEqual({
      kind: 'hold',
      reason: 'answer-in-flight'
    })
  })
})

describe('nativeChatCardComposerPlaceholder', () => {
  it('invites your own answer only for a one-question card', () => {
    expect(nativeChatCardComposerPlaceholder(null)).toBeNull()
    expect(nativeChatCardComposerPlaceholder(question(1))).toBe(
      'Type your own answer and press Enter…'
    )
    expect(nativeChatCardComposerPlaceholder(question(3))).toBe('Use the card above first…')
    expect(nativeChatCardComposerPlaceholder(approval)).toBe('Use the card above first…')
  })
})

