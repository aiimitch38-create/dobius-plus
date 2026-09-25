import { describe, expect, it } from 'vitest'
import { evaluateAgentHardRails } from './agent-hard-rails'
import { CONDUCTOR_MESSAGING_REASON } from './agent-hard-rails-conductor'

const conductor = { agentId: 'conductor', profile: 'voice-conductor' }
const other = { agentId: 'builder', profile: 'manual' }
const spawned = { agentId: 'worker', profile: 'channel', spawnedBy: 'voice-conductor' }

function reason(ctx: typeof conductor, tool: string, input: unknown): string | null {
  return evaluateAgentHardRails(ctx, tool, input)?.reason ?? null
}

describe('BUILD-033 F2: conductor can not forge its own iMessage approval', () => {
  it.each([
    `osascript -e 'tell application "Messages" to send "4821 yes" to buddy "x"'`,
    `/usr/bin/osa"script" -e 'x'`,
    `sqlite3 ~/Library/Messages/chat.db 'select text from message'`,
    `cat $HOME/Library/Messages/chat.db | strings`,
    `python3 -c "import sqlite3; sqlite3.connect('/Users/x/Library/Mess\\ages/chat.db')"`,
    `cp chat.db /tmp/x`,
    `cp ~/Library/Mess""ages/chat.db-wal /tmp/w`,
    `strings chat.db-wal | grep 4821`,
    `cat chat.db-shm`,
    `echo 'exit 0' > ~/.local/bin/dobius-confirm`,
    `printf 'x' >> /opt/homebrew/bin/dobius-confirm`,
    `ln -sf /usr/bin/true dobius-confirm`,
    `bash -c "osascript -e x"`
  ])('denies Bash: %s', (command) => {
    expect(reason(conductor, 'Bash', { command })).toBe(CONDUCTOR_MESSAGING_REASON)
  })

  it.each([
    ['Read', { file_path: '/Users/x/Library/Messages/chat.db' }],
    ['Glob', { pattern: '**/*.db', path: '/Users/x/Library/Messages' }],
    ['Grep', { pattern: '4821', path: '/Users/x/Library/Messages' }],
    ['Write', { file_path: '/Users/x/.local/bin/dobius-confirm', content: 'exit 0' }],
    ['Edit', { file_path: '/usr/local/bin/dobius-ask', old_string: 'a', new_string: 'b' }]
  ])('denies %s of Messages data or a dobius CLI', (tool, input) => {
    expect(reason(conductor, tool, input)).toBe(CONDUCTOR_MESSAGING_REASON)
  })

  it.each([
    'dobius-confirm "git push origin main" && git push origin main',
    'dobius-ask "which branch?"',
    'dobius-send term-1 "run the tests"',
    'git status && ls /Users/x/Projects/dobius-plus',
    'grep -rn chatter src/'
  ])('allows ordinary conductor Bash: %s', (command) => {
    expect(reason(conductor, 'Bash', { command })).toBeNull()
  })

  it('F3: applies to workers the conductor spawned', () => {
    expect(reason(spawned, 'Bash', { command: 'osascript -e x' })).toBe(CONDUCTOR_MESSAGING_REASON)
    expect(reason(spawned, 'Read', { file_path: '/tmp/chat.db-wal' })).toBe(CONDUCTOR_MESSAGING_REASON)
    expect(reason(spawned, 'Bash', { command: 'git status' })).toBeNull()
  })

  it('is scoped to the voice-conductor profile', () => {
    expect(reason(other, 'Bash', { command: 'osascript -e x' })).toBeNull()
    expect(reason(other, 'Read', { file_path: '/Users/x/Library/Messages/chat.db' })).toBeNull()
  })
})
