import { describe, expect, it } from 'vitest'
import { isLocalBashCommand, isLocalOnlyToolUse } from './agent-run-local-tools'

function bash(command: string): string {
  return JSON.stringify({ command, description: 'x' })
}

describe('isLocalOnlyToolUse', () => {
  it.each(['Read', 'Write', 'Edit', 'Grep', 'Glob', 'TodoWrite', 'NotebookEdit'])(
    'treats %s as local',
    (tool) => {
      expect(isLocalOnlyToolUse(tool, '{}')).toBe(true)
    }
  )

  it('treats the read-only dobius tools as local and the posting ones as outward', () => {
    expect(isLocalOnlyToolUse('mcp__dobius__read_knowledge')).toBe(true)
    expect(isLocalOnlyToolUse('mcp__dobius__post_channel_message')).toBe(false)
  })

  it.each([
    // A subagent's own tool calls are not classified.
    'Task',
    'Agent',
    'mcp__claude_ai_Gmail__send_message',
    'mcp__playwright__browser_click',
    'WebFetch',
    'SomeNewTool',
    '',
    undefined
  ])('fails closed for the tool %s', (tool) => {
    expect(isLocalOnlyToolUse(tool, '{}')).toBe(false)
  })

  it('fails closed when a Bash command cannot be read', () => {
    expect(isLocalOnlyToolUse('Bash')).toBe(false)
    expect(isLocalOnlyToolUse('Bash', 'not json')).toBe(false)
    expect(isLocalOnlyToolUse('Bash', '{"command":42}')).toBe(false)
    expect(isLocalOnlyToolUse('Bash', '{}')).toBe(false)
    expect(isLocalOnlyToolUse('Bash', bash('   '))).toBe(false)
  })

  it('judges a Bash call by its command', () => {
    expect(isLocalOnlyToolUse('Bash', bash('git status'))).toBe(true)
    expect(isLocalOnlyToolUse('Bash', bash('git push'))).toBe(false)
  })

  it('accepts a Bash progress tick, whose command was judged on its own event', () => {
    expect(isLocalOnlyToolUse('Bash', '12s')).toBe(true)
    expect(isLocalOnlyToolUse('mcp__claude_ai_Gmail__send_message', '12s')).toBe(false)
  })
})

describe('isLocalBashCommand', () => {
  it.each([
    'npm test',
    'pnpm test',
    'pnpm run typecheck:node',
    'pnpm --dir dobius run lint',
    'yarn lint',
    'npx vitest run --config config/vitest.config.ts src/shared',
    'pnpm exec oxlint src',
    './node_modules/.bin/tsc --noEmit',
    'uv run pytest -q',
    'git status && git commit -m "fix: the thing; and more"',
    'git -C /repo diff --stat',
    'git stash push -m wip',
    'git add src/a.ts',
    '/usr/bin/git log --oneline -5',
    'cat ~/.ssh/config',
    'grep -rn "ssh" docs | head -5',
    'ls -la; pwd',
    'cd dobius && npm test 2>&1 | tail -20',
    'find . -name "*.ts" -newer package.json',
    "echo 'curl is not run here' > notes.txt",
    'rm -rf dist'
  ])('treats `%s` as local', (command) => {
    expect(isLocalBashCommand(command)).toBe(true)
  })

  it.each([
    // Outward by name.
    'git push origin main',
    'git -C /repo push',
    'git fetch',
    'gh pr create --fill',
    'npm publish',
    'vercel --prod',
    'firebase deploy --only hosting',
    'curl https://example.com',
    'curl -X POST https://api.example.com/pay',
    'wget https://example.com',
    'dobius terminal send --terminal t1 --text hi',
    'osascript -e \'tell application "Messages" to send "hi"\'',
    'ssh host uptime',
    'scp file host:/tmp',
    'stripe charges create',
    // Unknown commands and scripts.
    'some-new-cli deploy',
    './deploy.sh',
    'bash scripts/release.sh',
    './ls',
    '/tmp/git status',
    'make test',
    'npm run deploy',
    'pnpm run build',
    'npm install left-pad',
    'npx some-package',
    'npx --yes vitest',
    // Inline interpreters.
    'node -e "require(\'child_process\').exec(\'curl x\')"',
    'python -c "import os"',
    'python3 script.py',
    'bash -c "ssh host"',
    // Bypass attempts.
    'git status; curl x',
    'git status && curl x',
    'git status || curl x',
    'git status | sh',
    'git status & curl x',
    'git status\ncurl x',
    'env FOO=1 bash -c "curl x"',
    'FOO=1 git status',
    'PATH=/tmp/evil:$PATH git status',
    'echo $(curl x)',
    'echo "$(curl x)"',
    'echo `curl x`',
    'cat <(curl x)',
    '(curl x)',
    '{ curl x; }',
    'echo hi > /dev/tcp/example.com/80',
    'git -c core.pager="curl x" log',
    'find . -name "*.ts" -exec curl x {} +',
    'rg --pre ./evil pattern',
    'sudo git status',
    'xargs curl < urls.txt',
    'eval "git status"',
    'echo "unterminated',
    '$CMD',
    ''
  ])('treats `%s` as outward', (command) => {
    expect(isLocalBashCommand(command)).toBe(false)
  })
})
