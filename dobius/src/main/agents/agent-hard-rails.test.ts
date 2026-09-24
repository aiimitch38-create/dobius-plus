import type * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluateAgentHardRails } from './agent-hard-rails'

// Pass-through spy so the tests can count filesystem resolutions (F3 cost bound).
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, realpathSync: vi.fn(actual.realpathSync) }
})

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
    expect(bash('cat ~/.dobius/notes/ideas.md && cat src/tokenizer.ts')).toBeNull()
    expect(bash('cd ~/.dobius/agents/agent-a && cat memory.md')).toBeNull()
    expect(bash('ls .dobius && cat .dobius/config.json')).toBeNull()
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

describe('agent hard rails: agents folder reached by case, cd or quoting (BUILD-005)', () => {
  const originalHome = process.env.HOME
  const fakeHome = '/Users/rails-test-user'

  beforeEach(() => {
    process.env.HOME = fakeHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
  })

  const caseInsensitiveFs = process.platform === 'darwin' || process.platform === 'win32'

  it.runIf(caseInsensitiveFs)('denies other-agent paths spelled in another letter case', () => {
    expect(
      evaluateAgentHardRails(ctx, 'Write', {
        file_path: `${fakeHome}/.Dobius/agents/other/MEMORY.md`,
        content: 'x'
      })?.reason
    ).toMatch(/another agent/)
    expect(
      evaluateAgentHardRails(ctx, 'Edit', {
        file_path: `${fakeHome}/.dobius/Agents/other/SOUL.md`,
        old_string: 'a',
        new_string: 'b'
      })?.reason
    ).toMatch(/another agent/)
    expect(
      evaluateAgentHardRails(ctx, 'Bash', { command: 'echo pwn >> ~/.dobius/AGENTS/other/MEMORY.md' })
        ?.reason
    ).toMatch(/another agent/)
    expect(
      evaluateAgentHardRails(ctx, 'Write', {
        file_path: `${fakeHome}/.DOBIUS/agents/AGENT-A/memory.md`,
        content: 'x'
      })
    ).toBeNull()
  })

  it.each([
    ['cd ~/.dobius/agents && cat other/MEMORY.md'],
    ['cd ~/.dobius/agents/other && echo x >> memory.md'],
    ['cat ~/.dobius/"agents"/other/x'],
    ["cat ~/.dobius/'agents'/other/x"],
    ['cat ~/.dobius/ag\\ents/other/x'],
    ['cd $HOME/.dobius && cat agents/other/memory.md'],
    ['ls ~/.dobius/agents/'],
    ['cd ~/.dobius/agents/agent-a && cat ../other/memory.md']
  ])('denies reaching another agent through the agents folder: %s', (command) => {
    expect(evaluateAgentHardRails(ctx, 'Bash', { command })?.reason).toMatch(/another agent/)
  })

  it.each([
    ['Read', { file_path: `${fakeHome}/.dobius/agents/sam/MEMORY.md` }],
    ['Read', { file_path: '~/.dobius/agents/sam/MEMORY.md' }],
    ['NotebookRead', { notebook_path: '$HOME/.dobius/agents/sam/notes.ipynb' }],
    ['Glob', { pattern: '~/.dobius/agents/sam/*' }],
    ['Glob', { path: fakeHome, pattern: '.dobius/agents/sam/**' }],
    ['Glob', { path: `${fakeHome}/.dobius/agents`, pattern: '*/MEMORY.md' }],
    ['Glob', { path: `${fakeHome}/.dobius`, pattern: '**/*.md' }],
    ['Glob', { path: `${fakeHome}/.dobius/agents/agent-a`, pattern: '../sam/*' }],
    ['Grep', { path: `${fakeHome}/.dobius/agents/sam`, pattern: 'secret' }],
    ['Grep', { path: `${fakeHome}/.dobius/agents`, pattern: 'secret' }],
    ['Grep', { path: fakeHome, glob: '.dobius/agents/sam/**', pattern: 'x' }]
  ])('denies reading another agent with %s %j', (tool, input) => {
    expect(evaluateAgentHardRails(ctx, tool, input)?.reason).toMatch(
      /may not read or edit another agent/
    )
  })

  it('lets read tools use the own agent folder and search text that names .dobius/agents', () => {
    expect(
      evaluateAgentHardRails(ctx, 'Read', { file_path: `${fakeHome}/.dobius/agents/agent-a/m.md` })
    ).toBeNull()
    expect(
      evaluateAgentHardRails(ctx, 'Glob', {
        path: `${fakeHome}/.dobius/agents/agent-a`,
        pattern: '**/*.md'
      })
    ).toBeNull()
    expect(
      evaluateAgentHardRails(ctx, 'Grep', { path: '/repo', pattern: '.dobius/agents/sam' })
    ).toBeNull()
  })

  it('treats .. as an escape only inside or after a cd into an agent folder', () => {
    const bash = (command: string) => evaluateAgentHardRails(ctx, 'Bash', { command })
    expect(bash('cat ../README.md ~/.dobius/agents/agent-a/memory.md')).toBeNull()
    expect(bash('cd /repo && cat ../x.md; cat ~/.dobius/agents/agent-a/m.md')).toBeNull()
    expect(bash('cd ~/.dobius/agents/agent-a && cd /repo && cat ../x.md')).toBeNull()
    expect(bash('cd ~/.dobius/agents/agent-a && cat ../sam/x')?.reason).toMatch(/another agent/)
    expect(bash('cd ~/.dobius/agents/agent-a; cd .. && cat sam/x')?.reason).toMatch(
      /another agent/
    )
    expect(bash('cat .dobius/agents/agent-a/../sam/x')?.reason).toMatch(/another agent/)
    expect(bash('cat ~/.dobius/agents/agent-a/../sam/x')?.reason).toMatch(/another agent/)
  })

  it('evaluates a 2000-path command well under a second', () => {
    const paths = Array.from(
      { length: 2000 },
      (_, index) => `/tmp/rails-missing-${index}/a/b/c/d/e/f/g/h.txt`
    )
    const started = performance.now()
    expect(evaluateAgentHardRails(ctx, 'Bash', { command: `cat ${paths.join(' ')}` })).toBeNull()
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('bounds symlink resolution: capped tokens, no realpath call per missing level', () => {
    const paths = Array.from(
      { length: 2000 },
      (_, index) => `/tmp/rails-missing-${index}/a/b/c/d/e/f/g/h.txt`
    )
    vi.mocked(realpathSync).mockClear()
    evaluateAgentHardRails(ctx, 'Bash', { command: `cat ${paths.join(' ')}` })
    // 64 resolved tokens × one call on their existing ancestor, plus the fixed
    // protected-location lookups. Uncapped or throw-per-level would be thousands.
    expect(vi.mocked(realpathSync).mock.calls.length).toBeLessThan(100)
  })

  it('still denies a credential path beyond the symlink-resolution budget', () => {
    const paths = Array.from({ length: 200 }, (_, index) => `/tmp/rails-missing-${index}/x`)
    const command = `cat ${paths.join(' ')} ${fakeHome}/.claude/.credentials.json`
    expect(evaluateAgentHardRails(ctx, 'Bash', { command })?.reason).toMatch(/credential/)
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
