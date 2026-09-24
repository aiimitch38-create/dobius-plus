import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { evaluateAgentHardRails } from './agent-hard-rails'

const ctx = { agentId: 'agent-a' }

describe('agent hard rails', () => {
  it('denies force-push including global-option and refspec forms', () => {
    expect(evaluateAgentHardRails(ctx, 'Bash', { command: 'git push --force' })).not.toBeNull()
    expect(
      evaluateAgentHardRails(ctx, 'Bash', { command: 'git push -f origin main' })
    ).not.toBeNull()
    expect(
      evaluateAgentHardRails(ctx, 'Bash', { command: 'git -C /tmp/wt push --force-with-lease' })
    ).not.toBeNull()
    expect(evaluateAgentHardRails(ctx, 'Bash', { command: 'git push origin +main' })).not.toBeNull()
  })

  it('allows normal git usage', () => {
    expect(evaluateAgentHardRails(ctx, 'Bash', { command: 'git push origin main' })).toBeNull()
    expect(evaluateAgentHardRails(ctx, 'Bash', { command: 'git commit -m "fix"' })).toBeNull()
  })

  it('denies credential targets but not content that merely mentions .env', () => {
    expect(evaluateAgentHardRails(ctx, 'Read', { file_path: '/repo/.env' })).not.toBeNull()
    expect(
      evaluateAgentHardRails(ctx, 'Bash', { command: 'cat ~/.claude/.credentials.json' })
    ).not.toBeNull()
    expect(
      evaluateAgentHardRails(ctx, 'Write', {
        file_path: '/repo/.gitignore',
        content: '.env\nnode_modules\n'
      })
    ).toBeNull()
    expect(
      evaluateAgentHardRails(ctx, 'Write', { file_path: '/repo/.env', content: 'X=1' })
    ).not.toBeNull()
  })

  it('isolates agent identities across Write and Bash', () => {
    const home = process.env.HOME ?? ''
    expect(
      evaluateAgentHardRails(ctx, 'Write', {
        file_path: `${home}/.dobius/agents/agent-b/memory.md`,
        content: 'x'
      })
    ).not.toBeNull()
    expect(
      evaluateAgentHardRails(ctx, 'Bash', { command: 'cat ~/.dobius/agents/agent-b/soul.md' })
    ).not.toBeNull()
    expect(
      evaluateAgentHardRails(ctx, 'Write', {
        file_path: `${home}/.dobius/agents/agent-a/memory.md`,
        content: 'x'
      })
    ).toBeNull()
  })
})

describe('agent hard rails: protected paths in every spelling (BUILD-005)', () => {
  const originalHome = process.env.HOME
  const fakeHome = '/Users/rails-test-user'

  beforeEach(() => {
    // Why: os.homedir() honours $HOME, so the rails see this literal /Users/<u> home.
    process.env.HOME = fakeHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
  })

  const bash = (command: string) => evaluateAgentHardRails(ctx, 'Bash', { command })

  it.each([
    [`cat ${fakeHome}/.claude/.credentials.json`],
    ['cat $HOME/.claude/.credentials.json'],
    ['cat ${HOME}/.claude/.credentials.json'],
    ['cat "$HOME/.claude/.credentials.json"'],
    ['cat ~rails-test-user/.claude/.credentials.json'],
    ['cat /Users/$USER/.claude/.credentials.json'],
    ['cd ~/.claude && cat .credentials.json'],
    ['echo hi; cat ${HOME}/.claude/.credentials.json | base64'],
    [`ls -la && cp ${fakeHome}/.claude/credentials.backup /tmp/x`],
    [`cat ${fakeHome}/notes/../.claude/.credentials.json`],
    [`cat ${fakeHome}//.claude//.credentials.json`],
    ['security dump-keychain $HOME/Library/Keychains/login.keychain-db'],
    [`cat ${fakeHome}/.dobius/connectors/slack/token.json`],
    ['cat $HOME/.dobius/connectors/slack/token.json']
  ])('denies credential access: %s', (command) => {
    expect(bash(command)?.reason).toMatch(/credential/)
  })

  it('denies credential paths given to non-Bash tools in any home spelling', () => {
    expect(
      evaluateAgentHardRails(ctx, 'Read', { file_path: `${fakeHome}/.claude/.credentials.json` })
    ).not.toBeNull()
    expect(
      evaluateAgentHardRails(ctx, 'Read', { file_path: '$HOME/.claude/.credentials.json' })
    ).not.toBeNull()
  })

  it.each([
    [`cat ${fakeHome}/.dobius/agents/agent-b/soul.md`],
    ['cat $HOME/.dobius/agents/agent-b/soul.md'],
    ['cat ${HOME}/.dobius/agents/agent-b/memory.md'],
    ['echo x >> "$HOME/.dobius/agents/agent-b/memory.md"'],
    ['git status && cp notes.md ${HOME}/.dobius/agents/agent-b/'],
    ['rm -rf /Users/$USER/.dobius/agents/agent-b']
  ])('denies another agent identity: %s', (command) => {
    expect(bash(command)?.reason).toMatch(/another agent/)
  })

  it('still lets an agent use its own identity and ordinary .dobius files', () => {
    expect(bash('cat $HOME/.dobius/agents/agent-a/memory.md')).toBeNull()
    expect(bash(`ls ${fakeHome}/.dobius/agents/agent-a/`)).toBeNull()
    expect(bash('ls ~/.claude/skills && cat $HOME/.claude/CLAUDE.md')).toBeNull()
    expect(bash('ls ~/.dobius/ && cat src/tokenizer.ts')).toBeNull()
  })

  it('allows ordinary chained commands and denies only real force-pushes', () => {
    expect(bash('git push && rm -rf dist')).toBeNull()
    expect(bash('git push origin main && rm -rf dist node_modules/.cache')).toBeNull()
    expect(bash('git push origin main; git log -f')).toBeNull()
    expect(bash('git push origin main | tee push.log && find . -name "*.tmp"')).toBeNull()
    expect(bash('git push -f')?.reason).toMatch(/force-push/)
    expect(bash('git push --force')?.reason).toMatch(/force-push/)
    expect(bash('git push -uf origin main')?.reason).toMatch(/force-push/)
    expect(bash('npm test && git push origin main -f')?.reason).toMatch(/force-push/)
    expect(bash('npm test && git -C /tmp/wt push --force-if-includes')?.reason).toMatch(
      /force-push/
    )
    expect(bash('(cd /tmp/wt && git push origin +main)')?.reason).toMatch(/force-push/)
  })
})

describe('agent hard rails: symlinked protected paths (BUILD-005)', () => {
  const originalHome = process.env.HOME
  let base = ''
  let home = ''

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'rails-'))
    home = join(base, 'home')
    mkdirSync(join(home, '.claude'), { recursive: true })
    // Placeholder bytes only — never a real credential.
    writeFileSync(join(home, '.claude', '.credentials.json'), '{}')
    mkdirSync(join(home, '.dobius', 'agents', 'agent-b'), { recursive: true })
    mkdirSync(join(home, 'Library', 'Keychains'), { recursive: true })
    mkdirSync(join(base, 'work'), { recursive: true })
    process.env.HOME = home
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(base, { recursive: true, force: true })
  })

  it('denies a symlink whose innocent name points at the credentials file', () => {
    const link = join(base, 'work', 'settings-copy')
    symlinkSync(join(home, '.claude', '.credentials.json'), link)
    expect(evaluateAgentHardRails(ctx, 'Bash', { command: `cat ${link}` })?.reason).toMatch(
      /credential/
    )
    expect(evaluateAgentHardRails(ctx, 'Read', { file_path: link })?.reason).toMatch(/credential/)
  })

  it('denies a symlink reached through $HOME, ${HOME} or ~ spellings', () => {
    mkdirSync(join(home, 'work'), { recursive: true })
    symlinkSync(join(home, '.claude', '.credentials.json'), join(home, 'work', 'settings-copy'))
    for (const command of [
      'cat $HOME/work/settings-copy',
      'cat ${HOME}/work/settings-copy',
      'echo start && cat ~/work/settings-copy'
    ]) {
      expect(evaluateAgentHardRails(ctx, 'Bash', { command })?.reason).toMatch(/credential/)
    }
  })

  it('denies a symlinked directory that leads into the keychains folder', () => {
    const link = join(base, 'work', 'kc')
    symlinkSync(join(home, 'Library', 'Keychains'), link)
    expect(
      evaluateAgentHardRails(ctx, 'Bash', { command: `ls ${link}/ && echo done` })?.reason
    ).toMatch(/credential/)
  })

  it("denies a symlink into another agent's identity folder", () => {
    const link = join(base, 'work', 'peer')
    symlinkSync(join(home, '.dobius', 'agents', 'agent-b'), link)
    expect(
      evaluateAgentHardRails(ctx, 'Write', { file_path: join(link, 'soul.md'), content: 'x' })
        ?.reason
    ).toMatch(/another agent/)
    expect(
      evaluateAgentHardRails(ctx, 'Bash', { command: `cat ${link}/soul.md` })?.reason
    ).toMatch(/another agent/)
  })

  it('allows an ordinary symlink that stays outside protected folders', () => {
    const target = join(base, 'work', 'real.txt')
    writeFileSync(target, 'ok')
    const link = join(base, 'work', 'alias.txt')
    symlinkSync(target, link)
    expect(evaluateAgentHardRails(ctx, 'Bash', { command: `cat ${link}` })).toBeNull()
  })
})
