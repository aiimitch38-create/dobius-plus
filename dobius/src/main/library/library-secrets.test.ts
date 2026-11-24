import { describe, expect, it } from 'vitest'
import {
  HIDDEN_SNIPPET,
  isSecretOrSkippedPath,
  scrubForIndex,
  scrubSnippet,
  scrubText
} from './library-secrets'

// Built at runtime so no key-shaped literal sits in the source.
const FAKE_KEY = `sk-proj-${'A1b2C3d4'.repeat(5)}`
const FAKE_GH = `ghp_${'x9Y8z7W6'.repeat(5)}`

describe('isSecretOrSkippedPath', () => {
  it('refuses secret files and skipped folders', () => {
    for (const path of [
      '/p/app/.env',
      '/p/app/.env.local',
      '/p/app/prod.env',
      '/p/app/server.pem',
      '/p/app/tls.key',
      '/home/.ssh/id_ed25519',
      '/p/hermes/auth.json',
      '/p/app/credentials.json',
      '/p/app/tokens.md',
      '/u/dobius-runtime-dev.json',
      '/p/app/node_modules/x/README.md',
      '/p/app/.git/HEAD',
      '/p/app/dist/README.md',
      '/v/API Keys.md'
    ]) {
      expect(isSecretOrSkippedPath(path), path).toBe(true)
    }
  })

  it('allows ordinary notes', () => {
    for (const path of ['/p/app/CLAUDE.md', '/p/app/plans/7.14-library.md', '/v/AI Research/Carson.md']) {
      expect(isSecretOrSkippedPath(path), path).toBe(false)
    }
  })
})

describe('scrubText', () => {
  it('redacts keys in place and drops credential lines, keeping paths', () => {
    const scrubbed = scrubText(
      [
        `The key is ${FAKE_KEY} for now`,
        'password: hunter2hunter2',
        'see src/main/jarvis/live-voice-quick-hands-runtime.ts for the wiring',
        `token ${FAKE_GH}`
      ].join('\n')
    )
    expect(scrubbed.text).not.toContain(FAKE_KEY)
    expect(scrubbed.text).not.toContain(FAKE_GH)
    expect(scrubbed.text).not.toContain('hunter2')
    expect(scrubbed.text).toContain('src/main/jarvis/live-voice-quick-hands-runtime.ts')
    expect(scrubbed.text).toContain('[redacted')
  })

  it('masks random-looking long tokens but not words joined by dashes', () => {
    const text = scrubText('id 4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a and very-long-hyphenated-plan-name-here').text
    expect(text).not.toContain('4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a')
    expect(text).toContain('very-long-hyphenated-plan-name-here')
  })
})

describe('scrubForIndex', () => {
  it('drops a chunk that is mostly secret', () => {
    const dump = [`OPENAI_API_KEY=${FAKE_KEY}`, `GITHUB_TOKEN=${FAKE_GH}`, 'password = abcdefgh', 'ok'].join('\n')
    expect(scrubForIndex(dump)).toBeNull()
  })

  it('keeps an ordinary chunk unchanged', () => {
    expect(scrubForIndex('Plan 7.14: build the library index.')).toBe(
      'Plan 7.14: build the library index.'
    )
  })
})

describe('scrubSnippet', () => {
  it('is strict, flattens lines and caps the length', () => {
    expect(scrubSnippet(`a\n b ${FAKE_KEY}`, 300)).not.toContain(FAKE_KEY)
    expect(scrubSnippet('api_key: something', 300)).toBe(HIDDEN_SNIPPET)
    expect(scrubSnippet('x '.repeat(400), 300).length).toBeLessThanOrEqual(300)
  })
})
