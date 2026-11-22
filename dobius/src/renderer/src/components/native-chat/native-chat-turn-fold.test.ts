import { describe, expect, it } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../../shared/native-chat-types'
import { foldOlderNativeChatTurns, type NativeChatFoldSegment } from './native-chat-turn-fold'

// Adapted from Line A #24 (electron/__tests__/chat-rows.test.mjs, foldTurns).
let seq = 0
function row(role: NativeChatMessage['role'], blocks: NativeChatBlock[], id?: string): NativeChatMessage {
  seq += 1
  return { id: id ?? `m${seq}`, role, blocks, timestamp: seq, source: 'transcript' }
}
const txt = (text: string): NativeChatBlock => ({ type: 'text', text })
const tool = (name: string): NativeChatBlock => ({ type: 'tool-call', name, input: {} })
const you = (text: string, id?: string): NativeChatMessage => row('user', [txt(text)], id)
const claude = (...blocks: NativeChatBlock[]): NativeChatMessage => row('assistant', blocks)

function shape(segments: NativeChatFoldSegment[]): string[] {
  return segments.map((s) =>
    s.kind === 'message' ? s.message.id : `${s.key}[${s.messages.map((m) => m.id).join(',')}]`
  )
}

describe('foldOlderNativeChatTurns', () => {
  const rows = [
    you('fix it', 'u0'),
    { ...claude(txt('looking'), tool('Bash'), tool('Read')), id: 'a1' },
    { ...claude(tool('Edit'), txt('Fixed the login bug.')), id: 'a2' },
    you('thanks', 'u3'),
    { ...claude(txt('Anytime.')), id: 'a4' },
    you('now the tests', 'u5'),
    { ...claude(tool('Bash'), txt('Running them.')), id: 'a6' }
  ]

  it('folds older turns with steps and leaves the newest exchange open', () => {
    const segments = foldOlderNativeChatTurns(rows)
    expect(shape(segments)).toEqual(['u0', 'turn:u3[a1,a2]', 'u3', 'a4', 'u5', 'a6'])
    const turn = segments[1]
    expect(turn).toMatchObject({ kind: 'turn', steps: 3, summary: 'Fixed the login bug.' })
  })

  it('folds the open exchange once a new message is sent', () => {
    const segments = foldOlderNativeChatTurns([...rows, you('ship it', 'u7')])
    expect(shape(segments).slice(-3)).toEqual(['u5', 'turn:u7[a6]', 'u7'])
  })

  it('keeps the last text as the summary, or none when the turn wrote no text', () => {
    const withText = foldOlderNativeChatTurns([you('a'), claude(txt('first'), tool('Bash')), you('b')])
    expect(withText[1]).toMatchObject({ kind: 'turn', summary: 'first' })
    const noText = foldOlderNativeChatTurns([you('a'), claude(tool('Bash')), you('b')])
    expect(noText[1]).toMatchObject({ kind: 'turn', summary: null })
  })

  it('counts reasoning rows as steps', () => {
    const segments = foldOlderNativeChatTurns([
      you('a'),
      row('reasoning', [txt('thinking')]),
      claude(txt('done')),
      you('b')
    ])
    expect(segments[1]).toMatchObject({ kind: 'turn', steps: 1, summary: 'done' })
  })

  it('folds rows above the first sent message when the window opens mid-turn', () => {
    const segments = foldOlderNativeChatTurns([claude(tool('Read'), txt('done')), you('next', 'n')])
    expect(segments[0]).toMatchObject({ kind: 'turn', key: 'turn:n', steps: 1, summary: 'done' })
  })

  it('folds nothing when no message was sent', () => {
    expect(shape(foldOlderNativeChatTurns([{ ...claude(tool('Read')), id: 'x' }]))).toEqual(['x'])
  })

  it('does not treat a queued (optimistic) send as a boundary', () => {
    const segments = foldOlderNativeChatTurns([...rows, you('then test it', 'pending:1')])
    expect(shape(segments).slice(-3)).toEqual(['u5', 'a6', 'pending:1'])
  })

  it('does not treat a user-role tool result as a sent message', () => {
    const segments = foldOlderNativeChatTurns([
      ...rows,
      row('user', [{ type: 'tool-result', output: 'ok' }, txt('extra')], 'tr'),
      { ...claude(txt('still going')), id: 'a9' }
    ])
    expect(shape(segments).slice(-4)).toEqual(['u5', 'a6', 'tr', 'a9'])
  })

  it('leaves a turn without steps unfolded', () => {
    const segments = foldOlderNativeChatTurns([you('hi', 'h'), { ...claude(txt('hello')), id: 'r' }, you('bye', 'b')])
    expect(shape(segments)).toEqual(['h', 'r', 'b'])
  })
})
