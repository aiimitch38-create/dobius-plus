import { describe, expect, it } from 'vitest'

import {
  BUG_FIX_AGENT,
  BUG_FIX_ALLOWED_TOOLS,
  BUG_FIX_DENIED_TOOLS,
  buildBugFixStartup
} from './bug-autofix-claude-profile'

describe('bug fix agent launch profile', () => {
  const startup = buildBugFixStartup('Fix the login button')

  it('launches Claude without any permission bypass', () => {
    expect(BUG_FIX_AGENT).toBe('claude')
    expect(startup.launchAgent).toBe('claude')
    expect(startup.command).toMatch(/^claude /)
    expect(startup.command).not.toMatch(/dangerously|bypassPermissions/)
    expect(startup.launchConfig?.agentArgs).not.toMatch(/dangerously/)
  })

  it('ignores inherited settings files and MCP servers and names its only tools', () => {
    expect(startup.command).toMatch(/^claude '--restricted' '--strict-mcp-config' '--tools' 'Bash,Read,Edit,Write,Glob,Grep' /)
    expect(startup.command).not.toContain('--mcp-config')
  })

  it('ends the variadic tool lists with --permission-mode before the prompt', () => {
    expect(startup.command).toMatch(/'--permission-mode' 'acceptEdits' 'Fix the login button'$/)
    expect(startup.command.indexOf('--disallowedTools')).toBeLessThan(
      startup.command.indexOf('--permission-mode')
    )
  })

  it('denies push, PRs, installs, the CLI build, rm -rf and --no-verify', () => {
    for (const rule of [
      'Bash(git push*)',
      'Bash(gh *)',
      'Bash(pnpm install*)',
      'Bash(npm install*)',
      'Bash(yarn*)',
      'Bash(rm -rf*)',
      'Bash(pnpm run build:cli*)',
      'Bash(*--no-verify*)',
      'Bash(*build-and-install*)'
    ]) {
      expect(BUG_FIX_DENIED_TOOLS).toContain(rule)
      expect(startup.command).toContain(rule)
    }
  })

  it('pre-allows only edits, git add/commit, typecheck and vitest', () => {
    expect(BUG_FIX_ALLOWED_TOOLS).toEqual(
      expect.arrayContaining([
        'Edit',
        'Bash(git add *)',
        'Bash(git commit *)',
        'Bash(pnpm run typecheck:node)',
        'Bash(npx vitest run *)'
      ])
    )
    expect(BUG_FIX_ALLOWED_TOOLS.some((tool) => /push|install|rm /.test(tool))).toBe(false)
  })
})

describe('bug fix agent extra read folders', () => {
  it('adds --add-dir inside the variadic block, before --permission-mode', () => {
    const { command } = buildBugFixStartup('Go', ['/ud/vertex-attachments/t1'])
    expect(command).toContain("'--add-dir' '/ud/vertex-attachments/t1' '--disallowedTools'")
    expect(command).toMatch(/'--permission-mode' 'acceptEdits' 'Go'$/)
  })
})
