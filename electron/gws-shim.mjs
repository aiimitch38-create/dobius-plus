// Dobius gws token-broker shim (v1.0.41).
//
// Placed first on a Dobius terminal's PATH as `gws`. It runs the REAL gws as a
// chosen Google account by minting a fresh GOOGLE_WORKSPACE_CLI_TOKEN from that
// account's stored refresh token, so a long-lived shell never carries a stale
// token (env injected at spawn goes dead in ~1h; this mints per invocation with
// a short-lived cache). Standalone: no Dobius/Electron imports, runs under
// `ELECTRON_RUN_AS_NODE=1 <electron> gws-shim.mjs`, so no node/python needed on
// the user's PATH.
//
// Selection (either):
//   DOBIUS_GWS_ACCOUNT=<email>   e.g. `DOBIUS_GWS_ACCOUNT=x@y.com gws gmail ...`
//   DOBIUS_GWS_ACCOUNT_ID=<id>   (set by a bound tab)
// When NEITHER is set it is a transparent passthrough to the real gws, so
// ordinary `gws` in a Dobius terminal behaves exactly as before.
//
// If an account IS requested but cannot be resolved or minted, it FAILS rather
// than silently running as the default account (running as the wrong Google
// account is worse than an error).

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';

const PROFILES_DIR = path.join(os.homedir(), '.gws-profiles');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function fail(msg, code = 1) {
  process.stderr.write(`dobius-gws: ${msg}\n`);
  process.exit(code);
}

// Locate the real gws, never this shim. Prefer DOBIUS_REAL_GWS (set by Dobius),
// else scan PATH skipping the shim's own dir.
function findRealGws() {
  const explicit = process.env.DOBIUS_REAL_GWS;
  if (explicit) {
    try { fs.accessSync(explicit, fs.constants.X_OK); return explicit; } catch { /* fall through */ }
  }
  const selfDir = process.env.DOBIUS_GWS_SHIM_SELF
    ? path.dirname(process.env.DOBIUS_GWS_SHIM_SELF)
    : null;
  for (const dir of (process.env.PATH || '').split(':')) {
    if (!dir || dir === selfDir) continue;
    const cand = path.join(dir, 'gws');
    try { fs.accessSync(cand, fs.constants.X_OK); return cand; } catch { /* next */ }
  }
  return null;
}

function runReal(realGws, env) {
  const r = spawnSync(realGws, process.argv.slice(2), { stdio: 'inherit', env });
  if (r.error) fail(`could not run gws (${r.error.code || 'unknown'})`, 127);
  process.exit(typeof r.status === 'number' ? r.status : 1);
}

// Find the requested account's profile by id or email. Returns
// { id, creds } | { error } | null (null = no account requested -> passthrough).
function resolveProfile() {
  const wantId = process.env.DOBIUS_GWS_ACCOUNT_ID || '';
  const wantEmail = (process.env.DOBIUS_GWS_ACCOUNT || '').toLowerCase();
  if (!wantId && !wantEmail) return null;
  let files;
  try {
    files = fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  } catch {
    return { error: 'no connected Google accounts' };
  }
  for (const f of files) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf8')); } catch { continue; }
    const id = f.slice(0, -'.json'.length);
    // ID is AUTHORITATIVE: when a bound tab sets DOBIUS_GWS_ACCOUNT_ID, match
    // ONLY by id and never fall back to email. Otherwise a stray
    // DOBIUS_GWS_ACCOUNT in the user's shell could win by readdir order and run
    // gws as the wrong Google account. Codex v1.0.41 holistic P2.
    if (wantId) {
      if (id === wantId) return { id, creds: j };
      continue;
    }
    if (wantEmail && typeof j.email === 'string' && j.email.toLowerCase() === wantEmail) return { id, creds: j };
  }
  return { error: `no connected gws account for ${process.env.DOBIUS_GWS_ACCOUNT_ID || process.env.DOBIUS_GWS_ACCOUNT}` };
}

const cacheFile = (id) => path.join(PROFILES_DIR, `.token-${id}.json`);

function readCachedToken(id) {
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(id), 'utf8'));
    if (c && typeof c.token === 'string' && c.expiresAt - Date.now() > 60 * 1000) return c.token;
  } catch { /* miss */ }
  return null;
}

function writeCachedToken(id, token, expiresIn) {
  try {
    fs.writeFileSync(
      cacheFile(id),
      JSON.stringify({ token, expiresAt: Date.now() + (expiresIn - 60) * 1000 }),
      { mode: 0o600 },
    );
  } catch { /* cache is best-effort */ }
}

async function mint(creds) {
  try {
    const body = new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: creds.refresh_token,
      grant_type: 'refresh_token',
    });
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.access_token) return { token: j.access_token, expiresIn: Number(j.expires_in) || 3600 };
    return { error: typeof j.error === 'string' ? j.error : `http_${r.status}` };
  } catch (e) {
    return { error: e?.code || 'network_error' };
  }
}

const realGws = findRealGws();
const target = resolveProfile();

if (!target) {
  // No account requested: transparent passthrough.
  if (!realGws) fail('real gws not found on PATH', 127);
  runReal(realGws, process.env);
} else if (target.error) {
  fail(target.error);
} else if (!realGws) {
  fail('real gws not found on PATH', 127);
} else if (!target.creds || typeof target.creds.refresh_token !== 'string') {
  fail(`stored credentials for that account are unreadable`);
} else {
  let token = readCachedToken(target.id);
  if (!token) {
    const m = await mint(target.creds);
    if (m.error) fail(`could not get an access token (${m.error})`);
    token = m.token;
    writeCachedToken(target.id, m.token, m.expiresIn);
  }
  runReal(realGws, { ...process.env, GOOGLE_WORKSPACE_CLI_TOKEN: token });
}
