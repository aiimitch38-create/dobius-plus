// Claude Desktop config merge for the one-click gws-mcp setup (v1.0.63).
// The merge writes into a file the USER may also hand-edit and other tools
// may own entries in, so: other servers survive, malformed refuses instead
// of clobbering, and the upsert is idempotent.
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const TMP_HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'dobius-gwsmcp-'));
process.env.DOBIUS_TEST_USERDATA = path.join(TMP_HOME, 'userdata');

const { mergeClaudeDesktopConfig, shSingleQuote, wrapperScript } = await import('../gws-mcp-install.js');
const { execFileSync } = await import('child_process');

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got=${JSON.stringify(got)}\n        want=${JSON.stringify(want)}`);
};

const W = '/Users/x/Library/Application Support/dobius-plus/gws-mcp/gws-mcp';

// First install: no file yet.
check('no existing config creates the entry from scratch',
  mergeClaudeDesktopConfig(null, W).next,
  { mcpServers: { gws: { command: W } } });
check('empty file treated as fresh',
  mergeClaudeDesktopConfig('   ', W).next,
  { mcpServers: { gws: { command: W } } });

// Other servers and unrelated top-level keys survive untouched.
{
  const existing = JSON.stringify({
    globalShortcut: 'Cmd+Space',
    mcpServers: { asana: { command: '/x/asana' }, gws: { command: '/old/path' } },
  });
  const { next } = mergeClaudeDesktopConfig(existing, W);
  check('unrelated top-level keys survive', next.globalShortcut, 'Cmd+Space');
  check('other servers survive', next.mcpServers.asana, { command: '/x/asana' });
  check('existing gws entry is upserted to the new path', next.mcpServers.gws, { command: W });
}

// Malformed existing config refuses rather than clobbers.
check('invalid JSON refuses', mergeClaudeDesktopConfig('{oops', W).error !== undefined, true);
check('array config refuses', mergeClaudeDesktopConfig('[1,2]', W).error !== undefined, true);
check('non-object mcpServers is replaced sanely',
  mergeClaudeDesktopConfig(JSON.stringify({ mcpServers: 'bad' }), W).next.mcpServers,
  { gws: { command: W } });

// Idempotent: merging the merged output changes nothing.
{
  const once = mergeClaudeDesktopConfig(null, W).next;
  const twice = mergeClaudeDesktopConfig(JSON.stringify(once), W).next;
  check('upsert is idempotent', twice, once);
}

// Wrapper quoting: paths with $, spaces, and quotes must survive /bin/sh
// literally (double quotes let $VARS expand; Codex Low).
{
  check('single-quote escaping wraps and escapes embedded quotes',
    shSingleQuote(`a'b`), `'a'\\''b'`);
  const hostileDir = path.join(TMP_HOME, `Dobius $HOME 'v2' app`);
  await fs.mkdir(hostileDir, { recursive: true });
  // Stand in a fake "electron": /bin/echo prints its argv, proving what sh
  // resolved after quoting.
  const wrapperPath = path.join(hostileDir, 'wrap');
  const fakeJs = path.join(hostileDir, `server $X.mjs`);
  await fs.writeFile(fakeJs, '');
  await fs.writeFile(wrapperPath, wrapperScript('/bin/echo', fakeJs), { mode: 0o755 });
  const out = execFileSync(wrapperPath, ['tail-arg']).toString().trim();
  check('hostile path reaches the binary UNEXPANDED, args intact',
    out, `${fakeJs} tail-arg`);
}

await fs.rm(TMP_HOME, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
