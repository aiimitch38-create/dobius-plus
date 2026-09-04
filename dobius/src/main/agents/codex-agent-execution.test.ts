import { describe, expect, it } from 'vitest'
import { codexErrorFromLine, codexMessageFromLine, unwrapCodexErrorMessage } from './codex-agent-execution'

// Fixtures captured live: `echo "say hello" | codex exec --json --skip-git-repo-check
// --sandbox workspace-write --model totally-invalid-model-xyz -` (2026-09-04, Edith
// diagnosis). Before this fix, none of these lines were ever read on a failed run —
// a non-zero exit with empty stderr fell back to the opaque "Codex exited with code N".
describe('codexErrorFromLine', () => {
  it('extracts the message from a top-level error event', () => {
    const line =
      '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'totally-invalid-model-xyz\' model is not supported when using Codex with a ChatGPT account.\\"}}"}'
    expect(codexErrorFromLine(line)).toBe(
      "The 'totally-invalid-model-xyz' model is not supported when using Codex with a ChatGPT account."
    )
  })

  it('extracts the message from a turn.failed event', () => {
    const line =
      '{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'totally-invalid-model-xyz\' model is not supported when using Codex with a ChatGPT account.\\"}}"}}'
    expect(codexErrorFromLine(line)).toBe(
      "The 'totally-invalid-model-xyz' model is not supported when using Codex with a ChatGPT account."
    )
  })

  it('returns null for non-error event types', () => {
    expect(codexErrorFromLine('{"type":"thread.started","thread_id":"x"}')).toBeNull()
    expect(codexErrorFromLine('{"type":"turn.completed","usage":{}}')).toBeNull()
    expect(
      codexErrorFromLine('{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}')
    ).toBeNull()
  })

  it('returns null for malformed JSON instead of throwing', () => {
    expect(codexErrorFromLine('not json')).toBeNull()
    expect(codexErrorFromLine('')).toBeNull()
  })
})

describe('unwrapCodexErrorMessage', () => {
  it('unwraps a JSON-encoded nested error.message', () => {
    expect(
      unwrapCodexErrorMessage(
        '{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"the real reason"}}'
      )
    ).toBe('the real reason')
  })

  it('returns the original string when it is not JSON', () => {
    expect(unwrapCodexErrorMessage('a plain error string')).toBe('a plain error string')
  })

  it('returns the original string when JSON but has no nested message', () => {
    expect(unwrapCodexErrorMessage('{"type":"error"}')).toBe('{"type":"error"}')
  })
})

describe('codexMessageFromLine (unchanged behavior, guarding against regressions in this file)', () => {
  it('still extracts the agent_message text', () => {
    expect(
      codexMessageFromLine('{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}')
    ).toBe('hello')
  })

  it('still ignores an error item', () => {
    expect(
      codexMessageFromLine('{"type":"item.completed","item":{"type":"error","message":"x"}}')
    ).toBeNull()
  })
})
