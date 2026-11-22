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

  it('pre-allows only file tools and read-only git; tests, typechecks and commits ask first', () => {
    expect(BUG_FIX_ALLOWED_TOOLS).toEqual([
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(git status*)',
      'Bash(git diff*)',
      'Bash(git log*)',
      'Bash(git show*)'
    ])
    const allowed = startup.command.slice(startup.command.indexOf("'--allowedTools'"))
    expect(allowed).not.toMatch(/vitest|typecheck|git commit|git add/)
  })

  it('never gives the agent an extra folder outside its workspace', () => {
    expect(startup.command).not.toContain('--add-dir')
  })
})
