// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { NativeChatBlock, NativeChatMessage } from '../../../../shared/native-chat-types'
import { NativeChatMessageList } from './NativeChatMessageList'
import type { NativeChatLiveSession } from './use-native-chat-live-session'

let seq = 0
function row(id: string, role: NativeChatMessage['role'], blocks: NativeChatBlock[]): NativeChatMessage {
  seq += 1
  return { id, role, blocks, timestamp: seq, source: 'transcript' }
}

function session(messages: NativeChatMessage[]): NativeChatLiveSession {
  return {
    messages,
    status: 'ready',
    sessionId: 's1',
    agent: 'claude',
    hasMore: false,
    loadingEarlier: false,
    loadEarlier: () => {}
  }
}

function renderList(messages: NativeChatMessage[]): void {
  render(
    <NativeChatMessageList
      session={session(messages)}
      isWorking={false}
      expandSignal={false}
      fontScale={1}
    />
  )
}

const transcript = [
  row('u1', 'user', [{ type: 'text', text: 'fix the login bug' }]),
  row('a1', 'assistant', [
    { type: 'text', text: 'Looking at the auth code.' },
    { type: 'tool-call', name: 'Read', input: {} },
    { type: 'tool-call', name: 'Edit', input: {} }
  ]),
  row('a2', 'assistant', [{ type: 'text', text: 'Fixed the login bug.' }]),
  row('u2', 'user', [{ type: 'text', text: 'now run the tests' }]),
  row('a3', 'assistant', [{ type: 'text', text: 'Running them now.' }])
]

describe('NativeChatMessageList older-turn fold', () => {
  afterEach(() => {
    cleanup()
  })

  it('folds an older turn to its last reply behind a Show N steps toggle', () => {
    renderList(transcript)

    expect(screen.getByText('Fixed the login bug.')).toBeInTheDocument()
    expect(screen.queryByText('Looking at the auth code.')).not.toBeInTheDocument()
    expect(screen.getByText('Running them now.')).toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: 'Show 2 steps' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)

    expect(screen.getByText('Looking at the auth code.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide steps' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('puts your own messages in the accent-colored box', () => {
    renderList(transcript)

    const bubbles = screen.getAllByTestId('native-chat-user-bubble')
    expect(bubbles).toHaveLength(2)
    for (const bubble of bubbles) {
      expect(bubble).toHaveAttribute('data-surface', 'board')
      expect(bubble.className).toContain('bg-[var(--board-accent-tint)]')
      expect(bubble.className).not.toContain('bg-card')
    }
  })
})
