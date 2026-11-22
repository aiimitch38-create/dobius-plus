import { describe, expect, it } from 'vitest'
import { isLocalBashCommand, isToolingPath } from './agent-run-local-bash'

describe('isLocalBashCommand', () => {
  it.each([
    'npm test',
    'pnpm test',
    'pnpm run typecheck:node',
    'pnpm --dir dobius run lint',
    'yarn lint',
    'npx vitest run --config config/vitest.config.ts src/shared',
    'pnpm exec oxlint src',
    'uv run pytest -q',
    'git status && git add src/a.ts',
    'git -C /repo diff --stat',
    'git -c core.hooksPath=/dev/null commit -m "fix: the thing; and more"',
    'git -c core.hooksPath=/dev/null checkout -b fix/thing',
    '/usr/bin/git log --oneline -5',
    'cat ~/.ssh/config',
    'grep -rn "ssh" docs | head -5',
    'ls -la; pwd',
    'cd dobius && npm test 2>&1 | tail -20',
    'npm test > out.txt 2>/dev/null',
    'find . -name "*.ts" -newer package.json',
    "echo 'curl is not run here' > notes.txt",
    'sort -u names.txt | uniq -c',
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
    './node_modules/.bin/tsc --noEmit',
    'node_modules/.bin/vitest run',
    'make test',
    'npm run deploy',
    'pnpm run build',
    'npm install left-pad',
    'npx some-package',
    'npx --yes vitest',
    'sed -n 1,5p file',
    'rg --pre ./evil pattern',
    // Inline interpreters.
    'node -e "require(\'child_process\').exec(\'curl x\')"',
    'python -c "import os"',
    'python3 script.py',
    'bash -c "ssh host"',
    // Chaining an outward command onto a local one.
    'git status; curl x',
    'git status && curl x',
    'git status || curl x',
    'git status | sh',
    'git status & curl x',
    'git status\ncurl x',
    'env FOO=1 bash -c "curl x"',
    'FOO=1 git status',
    'GIT_SSH_COMMAND=evil git status',
    'PATH=/tmp/evil:$PATH git status',
    'sudo git status',
    'xargs curl < urls.txt',
    'eval "git status"',
    '$CMD',
    // Substitution, subshells, groups.
    'echo $(curl x)',
    'echo "$(curl x)"',
    'echo `curl x`',
    'cat <(curl x)',
    '(curl x)',
    '{ curl x; }',
    // Network devices and odd redirections, with and without quoting tricks.
    'echo hi > /dev/tcp/example.com/80',
    'echo hi > "/dev/tcp/example.com/80"',
    "echo hi > /dev/'tcp'/example.com/80",
    'echo hi > /dev/t\\cp/example.com/80',
    'echo hi >/dev/udp/example.com/53',
    'cat < /dev/tcp/example.com/80',
    'cat /dev/tcp/example.com/80',
    'echo hi > $TARGET',
    'echo hi > "my file.txt"',
    'echo hi >',
    'cat <<EOF',
    'echo a>b',
    // Flags that make a local command run a program.
    'find . -name "*.ts" -exec curl x {} +',
    'find . -execdir sh -c "curl x" ;',
    'sort --compress-program=./evil big.txt',
    'sort --compress-p ./evil big.txt',
    'sort --c=./evil big.txt',
    'git -c core.pager="curl x" log',
    'git -c core.hooksPath=.evil commit -m x',
    'git -c core.hooksPath=/dev/null -c core.pager=evil commit -m x',
    'git diff --ext-diff',
    'git log --exec=evil',
    'git show --textconv',
    // Hook-running git subcommands without hooks switched off.
    'git commit -m "fix"',
    'git checkout main',
    'git switch main',
    'git stash push -m wip',
    'git merge main',
    'git rebase main',
    'git -c core.hooksPath=/dev/null push',
    'echo "unterminated',
    ''
  ])('treats `%s` as outward', (command) => {
    expect(isLocalBashCommand(command)).toBe(false)
  })
})

describe('isToolingPath', () => {
  it('names the files that decide what git and the check tools run', () => {
    expect(isToolingPath('.git/config')).toBe(true)
    expect(isToolingPath('C:\\repo\\node_modules\\x')).toBe(true)
    expect(isToolingPath('packages/app/package.json')).toBe(true)
    expect(isToolingPath('src/package.json.ts')).toBe(false)
    expect(isToolingPath('src/gitignore.ts')).toBe(false)
    expect(isToolingPath('.gitignore')).toBe(false)
    expect(isToolingPath('src/vitest-helpers/a.ts')).toBe(false)
  })
})
