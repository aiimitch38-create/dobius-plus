// gws-mcp argv building + flag-smuggling guards (v1.0.63). The MCP server
// hands model-controlled strings to execFile, so the positional allowlist is
// a security boundary: a tool call must never be able to inject gws flags
// like --upload or --output.
import { buildArgv, findGws } from '../../scripts/gws-mcp.mjs';

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

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
