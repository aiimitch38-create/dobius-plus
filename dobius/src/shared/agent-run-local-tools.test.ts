import { describe, expect, it } from 'vitest'
import { createLocalToolTracker, isLocalOnlyToolUse } from './agent-run-local-tools'

function bash(command: string): string {
  return JSON.stringify({ command, description: 'x' })
}

function write(filePath: string): string {
  return JSON.stringify({ file_path: filePath, content: 'x' })
}

describe('isLocalOnlyToolUse', () => {
  it.each(['Read', 'Write', 'Edit', 'Grep', 'Glob', 'TodoWrite', 'NotebookEdit'])(
    'treats %s as local',
    (tool) => {
      expect(isLocalOnlyToolUse(tool, write('/repo/src/a.ts'))).toBe(true)
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

describe('createLocalToolTracker: tooling files changed before a tool that runs them', () => {
  it('keeps test and git commands local after ordinary source edits', () => {
    const tools = createLocalToolTracker()
    expect(tools.isLocal('Edit', write('/repo/src/a.ts'))).toBe(true)
    expect(tools.isLocal('Write', write('/repo/src/a.test.ts'))).toBe(true)
    expect(tools.isLocal('Bash', bash('npm test'))).toBe(true)
    expect(tools.isLocal('Bash', bash('git status'))).toBe(true)
  })

  it.each([
    '/repo/package.json',
    '/repo/.git/hooks/pre-commit',
    '/repo/.git/config',
    '/repo/.husky/pre-commit',
    '/repo/node_modules/.bin/vitest',
    '/repo/node_modules/vitest/dist/cli.js',
    '/repo/vitest.config.ts',
    '/repo/config/vitest.config.ts',
    '/repo/.eslintrc.json',
    '/repo/tsconfig.node.json',
    '/repo/conftest.py',
    '/repo/.npmrc'
  ])('counts a check tool as outward after a write to %s', (filePath) => {
    const tools = createLocalToolTracker()
    expect(tools.isLocal('Write', write(filePath))).toBe(true)
    expect(tools.isLocal('Bash', bash('ls'))).toBe(true)
    expect(tools.isLocal('Bash', bash('npm test'))).toBe(false)
    expect(tools.isLocal('Bash', bash('npx vitest run'))).toBe(false)
    expect(tools.isLocal('Bash', bash('git status'))).toBe(false)
  })

  it('assumes the worst for a write whose target cannot be read', () => {
    const tools = createLocalToolTracker()
    expect(tools.isLocal('Edit', 'not json')).toBe(true)
    expect(tools.isLocal('Bash', bash('pnpm run typecheck'))).toBe(false)
  })

  it.each([
    'echo "{}" > package.json',
    'cp /tmp/hook .git/hooks/pre-commit',
    'mv evil.js node_modules/.bin/vitest',
    'touch .git/hooks/post-checkout',
    'rm vitest.config.ts',
    'cd .git',
    'find . -name "*.cfg" -delete',
    'sort -o package.json other.json',
    'sort --output=package.json other.json',
    'ls | uniq - package.json'
  ])('counts a check tool as outward after the Bash command `%s`', (command) => {
    const tools = createLocalToolTracker()
    expect(tools.isLocal('Bash', bash(command))).toBe(true)
    expect(tools.isLocal('Bash', bash('npm test'))).toBe(false)
  })

  it('refuses a line that changes tooling and runs it in one go', () => {
    expect(isLocalOnlyToolUse('Bash', bash('echo x > package.json && npm test'))).toBe(false)
    expect(isLocalOnlyToolUse('Bash', bash('touch .git/hooks/pre-commit; git status'))).toBe(false)
  })
})
