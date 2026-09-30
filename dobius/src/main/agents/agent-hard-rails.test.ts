import type * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAgentHardRailHooks, evaluateAgentHardRails } from './agent-hard-rails'

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

  it('denies the unrestricted Dobius CLI without blocking scoped conductor tools or repo work', () => {
    expect(
      evaluateAgentHardRails(ctx, 'Bash', { command: 'dobius agents remove --id another-agent' })
        ?.reason
    ).toMatch(/unrestricted Dobius CLI/)
    expect(
      evaluateAgentHardRails(ctx, 'Bash', {
        command: 'echo ready && /usr/local/bin/dobius terminal send --text go'
      })?.reason
    ).toMatch(/unrestricted Dobius CLI/)
    expect(evaluateAgentHardRails(ctx, 'Bash', { command: 'dobius-send tab go' })).toBeNull()
    expect(
      evaluateAgentHardRails(ctx, 'Bash', { command: 'cd /repo/dobius && pnpm test' })
    ).toBeNull()
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

  it('denies runtime and remote-auth files, except the conductor scoped token for its profile', () => {
    for (const file of [
      'dobius-runtime.json',
      'dobius-devices.json',
      'dobius-e2ee-keypair.json',
      'dobius-cli-token',
      'voice-conductor-cli-token'
    ]) {
      expect(
        evaluateAgentHardRails(ctx, 'Bash', {
          command: `cat "$HOME/Library/Application Support/dobius-plus/${file}"`
        })
      ).not.toBeNull()
    }
    expect(
      evaluateAgentHardRails({ agentId: 'conductor', profile: 'voice-conductor' }, 'Bash', {
        command: 'cat "$HOME/Library/Application Support/dobius-plus/voice-conductor-cli-token"'
      })
    ).toBeNull()
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
      evaluateAgentHardRails(ctx, 'Bash', {
        command: 'echo pwn >> ~/.dobius/AGENTS/other/MEMORY.md'
      })?.reason
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
    expect(bash('cd ~/.dobius/agents/agent-a; cd .. && cat sam/x')?.reason).toMatch(/another agent/)
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
    expect(evaluateAgentHardRails(ctx, 'Bash', { command: `cat ${link}/soul.md` })?.reason).toMatch(
      /another agent/
    )
  })

  it('allows an ordinary symlink that stays outside protected folders', () => {
    const target = join(base, 'work', 'real.txt')
    writeFileSync(target, 'ok')
    const link = join(base, 'work', 'alias.txt')
    symlinkSync(target, link)
    expect(evaluateAgentHardRails(ctx, 'Bash', { command: `cat ${link}` })).toBeNull()
  })
})

describe('agent hard rails: paths built from shell expansions (CX12 F6)', () => {
  const originalHome = process.env.HOME
  const fakeHome = '/Users/rails-test-user'
  const repoCwd = `${fakeHome}/Projects/app`

  beforeEach(() => {
    process.env.HOME = fakeHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
  })

  const bashIn = (command: string, cwd: string | undefined = repoCwd) =>
    evaluateAgentHardRails({ ...ctx, cwd }, 'Bash', { command })

  it.each([
    ['d="$HOME/.do"; d="${d}bius/agents"; cat "$d/other/MEMORY.md"'],
    ['cat "$(printf \'\\x2e\\x64obius/agents/other/MEMORY.md\')"'],
    ['cat `echo L2Rv | base64 -d`'],
    ['read d < p; cat "./$d"'],
    ['d=/Us; e=.dob; cat ${d}ers/rails-test-user/${e}ius/agents/other/MEMORY.md'],
    ["cat $'\\x2edobius/agents/other/MEMORY.md'"],
    ['eval echo hi'],
    ['cd ${PATH%%:*}/../..'],
    ['for f in .dob; do cat ../../${f}ius/agents/other/MEMORY.md; done'],
    ['for f in .dobius; do cat ~/$f/agents/other/MEMORY.md; done']
  ])('denies a path assembled at run time: %s', (command) => {
    expect(bashIn(command)?.reason).toMatch(/Hard rail/)
  })

  it.each([
    ['npm run build'],
    ['git status'],
    ['for f in *.ts; do wc -l "$f"; done'],
    ['for f in src/*.ts; do cp "$f" "dist/${f%.ts}.js"; done'],
    ['echo $PATH'],
    ['export PATH="$HOME/.local/bin:$PATH" && pnpm test'],
    ["awk '{print $1}' results.txt"],
    ["grep -E 'foo$' src/a.ts"],
    ['echo $(( 1 + 2 )) && echo $?'],
    ['cat .dobius/notes.md']
  ])('allows ordinary agent work in a repo: %s', (command) => {
    expect(bashIn(command)).toBeNull()
  })

  it('denies loop variables when the working directory can reach ~/.dobius', () => {
    const loop = 'for f in *.md; do cat "$f"; done'
    expect(bashIn(loop, fakeHome)?.reason).toMatch(/shell variable/)
    expect(bashIn(loop, `${fakeHome}/.dobius/agents/agent-a`)?.reason).toMatch(/shell variable/)
    expect(evaluateAgentHardRails(ctx, 'Bash', { command: loop })?.reason).toMatch(/shell variable/)
    expect(bashIn(loop)).toBeNull()
  })

  it('passes the SDK hook cwd to the rails', async () => {
    const hook = buildAgentHardRailHooks(ctx).PreToolUse[0].hooks[0]
    const call = (cwd: string) =>
      hook(
        {
          hook_event_name: 'PreToolUse',
          session_id: 's',
          transcript_path: '/t',
          cwd,
          tool_name: 'Bash',
          tool_input: { command: 'for f in *.ts; do wc -l "$f"; done' },
          tool_use_id: 'u'
        } as never,
        undefined,
        { signal: new AbortController().signal }
      )
    expect(await call(repoCwd)).toEqual({ continue: true })
    expect(await call(fakeHome)).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' }
    })
  })
})

describe('agent hard rails: force-push hidden in shell variables (CX12 F7)', () => {
  const bash = (command: string) => evaluateAgentHardRails(ctx, 'Bash', { command })

  it.each([
    ['F=--force; git push "$F" origin main'],
    ['git push $F origin main'],
    ['git push $(echo --force) origin main'],
    ['git push `echo -f` origin main'],
    [
      'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.push GIT_CONFIG_VALUE_0=+main:main git push'
    ],
    ['export GIT_CONFIG_PARAMETERS=x && git push origin main'],
    ['git -c remote.origin.push=+main:main push origin'],
    ['git push --\\force origin main']
  ])('denies an unverifiable push: %s', (command) => {
    expect(bash(command)?.reason).toMatch(/git push|force-push/)
  })

  it('still allows literal non-force pushes', () => {
    expect(bash('git push origin main')).toBeNull()
    expect(bash('git push -u origin feature/x')).toBeNull()
    expect(bash('npm test && git push origin main')).toBeNull()
  })
})

describe('agent hard rails: CX12 review follow-ups', () => {
  const originalHome = process.env.HOME
  const fakeHome = '/Users/rails-test-user'
  const repoCwd = `${fakeHome}/Projects/app`

  beforeEach(() => {
    process.env.HOME = fakeHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
  })

  const bashIn = (command: string) =>
    evaluateAgentHardRails({ ...ctx, cwd: repoCwd }, 'Bash', { command })

  const commitHeredoc = [
    "git commit -m \"$(cat <<'EOF'",
    "fix(x): it's done, costs $5 and `backticks` too",
    '',
    'git push --force is never used here',
    'EOF',
    ')"'
  ].join('\n')

  it.each([
    [commitHeredoc],
    [`${commitHeredoc} && git push origin HEAD`],
    [commitHeredoc.replace(/'EOF'/, '"EOF"')],
    ['gh pr create --title t --body "$(cat <<\'EOF\'\n## Summary\n- $x\nEOF\n)"'],
    ['NODE_ENV=test npm test && git push origin HEAD'],
    ['for i in {1..3}; do echo "$i"; done'],
    ["awk '{print}' a.txt"],
    ['curl -d "{\\"a\\":1,\\"b\\":2}" http://localhost:3000'],
    ['npm run build \\\n  --silent']
  ])('F5: allows normal agent work: %s', (command) => {
    expect(bashIn(command)).toBeNull()
  })

  it.each([
    ['F=--force; git push "$F" origin main'],
    ['git push origin main "--fo"rce'],
    ["git push origin ''+main"],
    ['\\git push --force origin main'],
    ['git pu""sh --force origin main'],
    ['g""it push -f origin main'],
    ['echo --force | xargs git push origin main'],
    ["git config remote.origin.push '+HEAD:refs/heads/main'"],
    ["git config --global alias.p 'push -f'"],
    ["git -c alias.p='push -f' p origin main"],
    ['git() { command git push -f "$@"; }; git push origin main'],
    ["cat <<'EOF' | bash\ngit push -f\nEOF"]
  ])('F3: denies a hidden or rewritten force-push: %s', (command) => {
    expect(bashIn(command)?.reason).toMatch(/Hard rail/)
  })

  it.each([
    ["bash -c 'd=$HOME/.do; cat ${d}bius/agents/other/MEMORY.md'"],
    ["sh -c 'cat ~/.$0/agents/other/MEMORY.md' dobius"],
    ["env bash -c 'cat ~/.dobius/agents/other/MEMORY.md'"],
    ['xargs -0 zsh -c "git push --force"'],
    ['bash -c "sh -c \'cat \\$0/x\' ~/.dobius/agents/other"']
  ])('F1: checks the inner command of sh -c: %s', (command) => {
    expect(bashIn(command)?.reason).toMatch(/Hard rail/)
  })

  it('F1: allows an ordinary sh -c', () => {
    expect(bashIn("bash -c 'npm run build && git status'")).toBeNull()
  })

  it.each([
    ['cat ~/.{dobius,x}/agents/other/MEMORY.md'],
    ['cat ~/.do{b,}ius/agents/other/MEMORY.md'],
    ['cat ~/.dob{i..i}us/agents/other/MEMORY.md'],
    ['cat ~/.dob\\\nius/agents/other/MEMORY.md'],
    ['echo agents/other/MEMORY.md | xargs -I@ cat ~/.dobius/@'],
    ['cd /; cd Users; cd rails-test-user; cd .dobius; for f in agents; do cat $f/other/x; done']
  ])('F2: denies stopgap path assembly: %s', (command) => {
    expect(bashIn(command)?.reason).toMatch(/Hard rail/)
  })
})

describe('agent hard rails: CX12 r2 review', () => {
  const originalHome = process.env.HOME
  const fakeHome = '/Users/rails-test-user'
  const repoCwd = `${fakeHome}/Projects/app`

  beforeEach(() => {
    process.env.HOME = fakeHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
  })

  const bashIn = (command: string) =>
    evaluateAgentHardRails({ ...ctx, cwd: repoCwd }, 'Bash', { command })
  const push = 'git push --force origin main'
  const built = 'x=bius; cat ~/.do${x}/agents/other/M'

  it.each(
    [push, built].flatMap((body) => [
      [`sh -c "$(cat <<'EOF'\n${body}\nEOF\n)"`],
      [`$(cat <<'EOF'\n${body}\nEOF\n)`],
      [`sh <(cat <<'EOF'\n${body}\nEOF\n)`],
      [`cat <<'EOF' > >(sh)\n${body}\nEOF`],
      [`cat <<'EOF' > p.sh\n${body}\nEOF\nsh p.sh`],
      [`eval "$(cat <<'EOF'\n${body}\nEOF\n)"`]
    ])
  )('F1: scans heredoc bodies that run as code: %s', (command) => {
    expect(bashIn(command)?.reason).toMatch(/Hard rail/)
  })

  it.each([
    [`bash --norc -c '${built}'`],
    [`bash -o pipefail -c '${built}'`],
    [`bash -c -- '${built}'`],
    [`bash -O extglob -c '${push}'`],
    [`bash +o posix --login -c '${push}'`],
    ["bash -c 'unterminated"]
  ])('F2: parses sh options before -c: %s', (command) => {
    expect(bashIn(command)?.reason).toMatch(/Hard rail/)
  })

  it.each([
    ['git add -A && git commit -m "$(cat <<\'EOF\'\nchore: add .env.example and docs\nEOF\n)"'],
    [
      'git commit -m "$(cat <<\'EOF\'\nfix(agents): deny reads of ~/.dobius/agents/<other>\nEOF\n)"'
    ],
    ['git commit -m "docs: explain why git push -f is blocked"'],
    ["bash -lc 'npm run typecheck'"],
    ['bash -o pipefail -c "npm test | tee out.log"'],
    ['NODE_ENV=test npm test && git push origin HEAD'],
    ["awk '{print $1}' file.txt"]
  ])('F3: allows commit text and ordinary commands: %s', (command) => {
    expect(bashIn(command)).toBeNull()
  })
})

describe('agent hard rails: CX12 r3 review (fail-closed data rules)', () => {
  const originalHome = process.env.HOME
  const fakeHome = '/Users/rails-test-user'
  const repoCwd = `${fakeHome}/Projects/app`
  const other = `${fakeHome}/.dobius/agents/other/M`

  beforeEach(() => {
    process.env.HOME = fakeHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
  })

  const bashIn = (command: string) =>
    evaluateAgentHardRails({ ...ctx, cwd: repoCwd }, 'Bash', { command })

  it.each([
    ["cat <<'EOF' > x.ts\nconst a = `${b}/c`\nEOF"],
    ["cat <<'EOF' > notes.md\nPrice: $5\nEOF"],
    ['cat <<\'EOF\' > run.sh\n#!/bin/sh\ncd "$1" && ls\nEOF'],
    ["cat <<'EOF'\nusage: $0 <dir>\nEOF"],
    ["cat > notes.md <<'EOF'\ncost is $5 and $(date) literal\nEOF"],
    ["cat > notes.md <<'EOF'\nwe block git push -f here\nEOF"],
    ["cat <<'EOF' > notes.md\n| a | b |\nEOF"],
    ["git commit -F- <<'EOF'\ndocs: explain why git push -f is blocked\nEOF"],
    ["gh pr create --title t --body-file - <<'EOF'\n## Summary\nhandles $HOME\nEOF"],
    ['gh pr create --title "$(git log -1 --format=%s)"'],
    ['git commit -m "$(cat <<\'EOF\'\nfix\nEOF\n)" && bash scripts/check.sh'],
    ['git commit -m "$(cat <<\'EOF\'\nfix: shell rails for sh -c and eval\nEOF\n)"'],
    ['git commit -m "docs: explain why git push -f is blocked"'],
    ['git stash push -m "wip"'],
    ['git -C dobius push origin HEAD'],
    ["python3 - <<'EOF'\nprint(1)\nEOF"]
  ])('F3/F6: allows data heredocs and messages: %s', (command) => {
    expect(bashIn(command)).toBeNull()
  })

  it.each([
    [`python3 -c "$(cat <<'EOF'\nprint(open('${other}').read())\nEOF\n)"`],
    [`echo "$(cat <<'EOF'\nprint(open('${other}').read())\nEOF\n)" | python3`],
    [`python3 - <<'EOF'\nprint(open('${other}').read())\nEOF`],
    ["perl -e \"$(cat <<'EOF'\nsystem('git push -f')\nEOF\n)\""],
    ['echo "$(cat <<\'EOF\'\ngit push -f\nEOF\n)" | sh'],
    ['printf %s "$(cat <<\'EOF\'\ngit push -f\nEOF\n)" > p.sh && sh p.sh'],
    ["cat <<'EOF' > p.sh\ngit push --force origin main\nEOF\nchmod +x p.sh && ./p.sh"],
    ['git commit -m "$(cat <<\'EOF\'\nx\nEOF\n)" | sh'],
    ['x="$(cat <<\'EOF\'\ngit push -f\nEOF\n)"; $x'],
    ['gh pr create --title "$(cat ~/.dobius/agents/other/M)"']
  ])('F2/F4: interpreter or re-used heredocs are scanned: %s', (command) => {
    expect(bashIn(command)?.reason).toMatch(/Hard rail/)
  })

  it.each([
    ['git --config-env core.x=Y push -f origin main'],
    ['git --attr-source HEAD push -f origin main'],
    ['git --super-prefix x/ push -f origin main'],
    ['git --no-pager push --mirror origin'],
    ['git push origin :main'],
    ['git push --delete origin main'],
    ['git --config-env=alias.p=X p'],
    ["X='push -f' git --config-env alias.p=X p"]
  ])('F1/F5: git push detection fails closed: %s', (command) => {
    expect(bashIn(command)?.reason).toMatch(/Hard rail/)
  })
})
