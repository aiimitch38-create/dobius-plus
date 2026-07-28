// gws token-broker shim routing (v1.0.41). Covers the HTTP-free paths:
// transparent passthrough (no account) and requested-but-unconnected (error,
// no gws run). The mint path needs live Google HTTP and is proven when Sam
// connects and runs the shim in a real terminal.
import { spawnSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const SHIM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gws-shim.mjs');

let pass = 0, fail = 0;
const check = (label, cond) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
};

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dobius-shim-home-'));
const fakeGws = path.join(home, 'fake-gws.sh');
await fs.writeFile(fakeGws, '#!/bin/sh\necho "REAL args=[$*] token=${GOOGLE_WORKSPACE_CLI_TOKEN:-none}"\nexit 7\n', { mode: 0o755 });
await fs.chmod(fakeGws, 0o755);

const run = (env, args) => spawnSync(process.execPath, [SHIM, ...args], {
  env: { ...process.env, HOME: home, DOBIUS_REAL_GWS: fakeGws, ...env },
  encoding: 'utf8',
});

// 1. Passthrough: no account requested -> runs the real gws, no token, and
//    propagates the real gws exit code (7).
{
  const r = run({}, ['gmail', 'list']);
  check('passthrough runs real gws with args', r.stdout.includes('args=[gmail list]'));
  check('passthrough injects NO token', r.stdout.includes('token=none'));
  check('passthrough propagates real gws exit code', r.status === 7);
}

// 2. Account requested but none connected -> error, real gws NOT run, exit 1.
{
  const r = run({ DOBIUS_GWS_ACCOUNT: 'nobody@example.com' }, ['gmail', 'list']);
  check('unconnected account errors', /no connected/i.test(r.stderr));
  check('unconnected account does NOT run real gws', !r.stdout.includes('REAL'));
  check('unconnected account exits non-zero', r.status === 1);
}

// 3. Account requested by id but profile missing -> error, no gws run.
{
  const r = run({ DOBIUS_GWS_ACCOUNT_ID: 'gws-doesnotexist000000' }, ['x']);
  check('unknown id errors', /no connected/i.test(r.stderr));
  check('unknown id does NOT run real gws', !r.stdout.includes('REAL'));
}

await fs.rm(home, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
