// gws-mcp argv building + flag-smuggling guards (v1.0.63). The MCP server
// hands model-controlled strings to execFile, so the positional allowlist is
// a security boundary: a tool call must never be able to inject gws flags
// like --upload or --output.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildArgv, findGws, gwsInvocation, claudeDesktopDirFor, mergeClaudeConfig } from '../gws-mcp.mjs';

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got=${JSON.stringify(got)}\n        want=${JSON.stringify(want)}`);
};

// Happy path: positional parts + params + body in gws's own flag shapes.
check('gmail list builds the documented argv',
  buildArgv({ command: ['gmail', 'users', 'messages', 'list'], params: { userId: 'me', maxResults: 5 } }).argv,
  ['gmail', 'users', 'messages', 'list', '--params', '{"userId":"me","maxResults":5}']);
check('body rides --json',
  buildArgv({ command: ['gmail', 'users', 'messages', 'send'], body: { raw: 'x' } }).argv,
  ['gmail', 'users', 'messages', 'send', '--json', '{"raw":"x"}']);
check('unlisted API via service:version positional',
  buildArgv({ command: ['people:v1', 'people', 'get'] }).argv,
  ['people:v1', 'people', 'get']);
check('apiVersion + format + pageAll append their flags',
  buildArgv({ command: ['drive', 'files', 'list'], apiVersion: 'v2', format: 'table', pageAll: true }).argv,
  ['drive', 'files', 'list', '--api-version', 'v2', '--format', 'table', '--page-all']);

// The security boundary: no flag smuggling through positionals.
check('a leading-dash positional is rejected',
  buildArgv({ command: ['drive', '--upload'] }).error !== undefined, true);
check('a path-looking positional is rejected',
  buildArgv({ command: ['drive', 'files', '/etc/passwd'] }).error !== undefined, true);
check('whitespace in a positional is rejected',
  buildArgv({ command: ['drive', 'files list'] }).error !== undefined, true);
check('too few parts rejected', buildArgv({ command: ['drive'] }).error !== undefined, true);
check('too many parts rejected',
  buildArgv({ command: ['a', 'b', 'c', 'd', 'e', 'f'] }).error !== undefined, true);
check('non-array command rejected', buildArgv({ command: 'drive files list' }).error !== undefined, true);

// params/body must be objects; arrays and strings would change gws semantics.
check('string params rejected', buildArgv({ command: ['a', 'b'], params: 'x' }).error !== undefined, true);
check('array body rejected', buildArgv({ command: ['a', 'b'], body: [1] }).error !== undefined, true);
check('bad format rejected', buildArgv({ command: ['a', 'b'], format: 'xml' }).error !== undefined, true);
check('apiVersion with a dash-prefix rejected', buildArgv({ command: ['a', 'b'], apiVersion: '--x' }).error !== undefined, true);

// findGws returns an absolute homebrew/usr-local path or the bare name; it
// must never resolve into a Dobius shim dir (those live under userData).
const gwsPath = findGws();
check('findGws avoids Dobius shim dirs', gwsPath.includes('dobius') || gwsPath.includes('Application Support'), false);

// --- Windows support (v1.0.64): invocation resolution + config paths. gws on
// Windows is a .cmd shim Node cannot execFile, so the CLI's JS entry must run
// under our own node; the config dir comes from APPDATA. ---
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gwsmcp-win-'));
  const fakeCliDir = path.join(tmp, 'npm', 'node_modules', '@googleworkspace', 'cli', 'bin');
  fs.mkdirSync(fakeCliDir, { recursive: true });
  fs.writeFileSync(path.join(fakeCliDir, 'gws'), '// fake cli entry');

  const inv2 = gwsInvocation('win32', { APPDATA: tmp });
  check('win32 resolves the CLI js under APPDATA npm prefix and runs it under our node',
    inv2.argsPrefix?.[0] === path.join(tmp, 'npm', 'node_modules', '@googleworkspace', 'cli', 'bin', 'gws')
      && inv2.file === process.execPath, true);
  check('win32 with no CLI installed reports an actionable error',
    typeof gwsInvocation('win32', { APPDATA: path.join(tmp, 'nope') }).error, 'string');
  check('GWS_MCP_GWS_JS override wins',
    gwsInvocation('win32', { GWS_MCP_GWS_JS: path.join(fakeCliDir, 'gws') }).argsPrefix?.[0],
    path.join(fakeCliDir, 'gws'));
  // Current releases publish bin as run.js at the package ROOT (Codex High):
  // the package's own bin map must win over any literal guess.
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gwsmcp-win2-'));
  const pkgDir2 = path.join(tmp2, 'npm', 'node_modules', '@googleworkspace', 'cli');
  fs.mkdirSync(pkgDir2, { recursive: true });
  fs.writeFileSync(path.join(pkgDir2, 'package.json'), JSON.stringify({ bin: { gws: 'run.js' } }));
  fs.writeFileSync(path.join(pkgDir2, 'run.js'), '// entry');
  check('win32 resolves the entry from the package bin map (run.js layout)',
    gwsInvocation('win32', { APPDATA: tmp2 }).argsPrefix?.[0], path.join(pkgDir2, 'run.js'));
  fs.rmSync(tmp2, { recursive: true, force: true });
  check('posix path untouched by win32 logic', gwsInvocation('darwin', {}).argsPrefix, []);

  check('claude dir on win32 comes from APPDATA',
    claudeDesktopDirFor('win32', { APPDATA: 'C:\\Users\\b\\AppData\\Roaming' }, '/h'),
    path.join('C:\\Users\\b\\AppData\\Roaming', 'Claude'));
  check('claude dir on win32 without APPDATA is null (setup must refuse)',
    claudeDesktopDirFor('win32', {}, '/h'), null);
  check('claude dir on darwin is the Library path',
    claudeDesktopDirFor('darwin', {}, '/Users/b'),
    '/Users/b/Library/Application Support/Claude');
  check('GWS_MCP_CLAUDE_DIR override wins on any platform',
    claudeDesktopDirFor('win32', { GWS_MCP_CLAUDE_DIR: '/tmp/x' }, '/h'), '/tmp/x');

  check('config merge preserves other servers',
    mergeClaudeConfig('{"mcpServers":{"a":{"command":"/x"}}}', { command: 'node', args: ['/s'] }).next.mcpServers.a,
    { command: '/x' });
  check('config merge refuses malformed', typeof mergeClaudeConfig('{oops', {}).error, 'string');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
