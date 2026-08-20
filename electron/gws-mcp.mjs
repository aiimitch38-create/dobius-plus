#!/usr/bin/env node
// gws-mcp: a zero-dependency MCP (stdio) server that gives Claude Desktop /
// Claude Code / Cursor the FULL Google Workspace API surface through the gws
// CLI, as ANY connected Google account.
//
// Why this exists: Claude Desktop's native Gmail connector is one account at
// a time (Sam, 8/17), and community Workspace MCP servers hand-write one tool
// per operation, so they cover a fraction of the APIs and are single-account.
// gws is a generic passthrough to every Workspace API (plus any Google API
// via `service:version`), and Dobius already stores one refresh token per
// account in ~/.gws-profiles (0600, written by the desktop app's Connect
// flow). This server joins the two: three generic tools, account selected by
// email per call, tokens minted in-process and never surfaced.
//
// Register (Claude Desktop: ~/Library/Application Support/Claude/
// claude_desktop_config.json; Claude Code: `claude mcp add`):
//   { "mcpServers": { "gws": {
//       "command": "/opt/homebrew/bin/node",
//       "args": ["<absolute path to this file>"] } } }
//
// Security posture (mirrors electron/gws-shim.mjs):
// - An explicitly requested account that cannot be resolved or minted FAILS
//   the call; it never silently falls back to the base gws identity.
// - Refresh/access tokens never appear in tool results or logs.
// - Positional CLI parts are allowlisted ([A-Za-z0-9:._-], no leading dash),
//   so a tool call cannot smuggle flags like --upload into the gws argv.
// - No file upload/download tools: this server never reads or writes the
//   local filesystem on behalf of the model.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

const PROFILES_DIR = path.join(os.homedir(), '.gws-profiles');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GWS_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 60_000; // MCP result ceiling; gws supports paging anyway
const EXEC_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');

// ---------------------------------------------------------------------------
// Accounts + token minting (same shape the Dobius shim uses)
// ---------------------------------------------------------------------------

export function listAccounts() {
  let files;
  try {
    files = fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf8'));
      if (typeof j.email === 'string' && j.email) out.push({ email: j.email });
    } catch { /* unreadable profile: skip */ }
  }
  return out.sort((a, b) => a.email.localeCompare(b.email));
}

function profileForEmail(email) {
  const want = String(email).toLowerCase();
  let files;
  try {
    files = fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  } catch {
    return null;
  }
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf8'));
      if (String(j.email || '').toLowerCase() === want
          && j.client_id && j.client_secret && j.refresh_token) return j;
    } catch { /* skip */ }
  }
  return null;
}

// access-token cache: email -> { token, exp }. In-memory only.
const tokenCache = new Map();

async function mintToken(email) {
  const hit = tokenCache.get(email);
  if (hit && Date.now() < hit.exp) return hit.token;
  const prof = profileForEmail(email);
  if (!prof) throw new Error(`no connected account for ${email}. Connect it in Dobius+ Settings first (gws_accounts lists what is available).`);
  const body = new URLSearchParams({
    client_id: prof.client_id,
    client_secret: prof.client_secret,
    refresh_token: prof.refresh_token,
    grant_type: 'refresh_token',
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    const reason = j.error === 'invalid_grant'
      ? 'Google revoked this grant; reconnect the account in Dobius+ Settings'
      : (j.error || `http_${r.status}`);
    throw new Error(`could not mint a token for ${email}: ${reason}`);
  }
  tokenCache.set(email, { token: j.access_token, exp: Date.now() + (Number(j.expires_in || 3600) - 60) * 1000 });
  return j.access_token;
}

// ---------------------------------------------------------------------------
// gws invocation
// ---------------------------------------------------------------------------

/** The real gws binary; never a Dobius shim (those live under userData). */
export function findGws() {
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) {
    const cand = path.join(dir, 'gws');
    try { fs.accessSync(cand, fs.constants.X_OK); return cand; } catch { /* next */ }
  }
  return 'gws'; // PATH fallback
}

/**
 * How to invoke gws on this platform: { file, argsPrefix } or { error }.
 * POSIX runs the binary directly. Windows cannot execFile a .cmd shim (Node
 * refuses .cmd without a shell, and shell:true would put our JSON args
 * through cmd.exe quoting), so we run the CLI's JS entry under the SAME node
 * that runs this server. Parameterized for tests.
 */
export function gwsInvocation(platform = process.platform, env = process.env) {
  if (platform !== 'win32') return { file: findGws(), argsPrefix: [] };
  const candidates = [];
  if (env.GWS_MCP_GWS_JS) candidates.push(env.GWS_MCP_GWS_JS);
  // npm's default global prefix on Windows is %APPDATA%\npm. The package's
  // bin entry has MOVED across releases (bin/gws in older versions, run.js
  // in current ones; Codex High), so resolve it from the package's OWN bin
  // map first and only then fall back to the known literal names.
  if (env.APPDATA) {
    const pkgDir = path.join(env.APPDATA, 'npm', 'node_modules', '@googleworkspace', 'cli');
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
      const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.gws;
      if (typeof bin === 'string' && bin) candidates.push(path.join(pkgDir, bin));
    } catch { /* no package.json: fall through to literals */ }
    candidates.push(path.join(pkgDir, 'run.js'));
    candidates.push(path.join(pkgDir, 'bin', 'gws'));
  }
  for (const cand of candidates) {
    try { fs.accessSync(cand, fs.constants.R_OK); return { file: process.execPath, argsPrefix: [cand] }; } catch { /* next */ }
  }
  return { error: 'gws CLI not found. Install it with: npm i -g @googleworkspace/cli (or set GWS_MCP_GWS_JS to its JS entry path).' };
}

// First char must not be a dash, or "--upload" would pass the class check
// and smuggle a flag into the argv.
const POSITIONAL_RE = /^[A-Za-z0-9:._][A-Za-z0-9:._-]*$/;

/**
 * Build a gws argv from a tool call. Positionals are allowlisted so a call
 * can never smuggle flags; params/body are objects we stringify ourselves.
 * Returns { argv } or { error }.
 */
export function buildArgv({ command, params, body, apiVersion, format, pageAll }) {
  if (!Array.isArray(command) || command.length < 2 || command.length > 5) {
    return { error: 'command must be an array of 2-5 parts, e.g. ["gmail","users","messages","list"]' };
  }
  for (const part of command) {
    if (typeof part !== 'string' || !POSITIONAL_RE.test(part)) {
      return { error: `invalid command part ${JSON.stringify(part)}: letters, digits, :._- only` };
    }
  }
  const argv = [...command];
  if (params !== undefined) {
    if (typeof params !== 'object' || params === null || Array.isArray(params)) return { error: 'params must be a JSON object' };
    argv.push('--params', JSON.stringify(params));
  }
  if (body !== undefined) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'body must be a JSON object' };
    argv.push('--json', JSON.stringify(body));
  }
  if (apiVersion !== undefined) {
    if (typeof apiVersion !== 'string' || !POSITIONAL_RE.test(apiVersion)) return { error: 'invalid apiVersion' };
    argv.push('--api-version', apiVersion);
  }
  if (format !== undefined) {
    if (!['json', 'table', 'yaml', 'csv'].includes(format)) return { error: 'format must be json|table|yaml|csv' };
    argv.push('--format', format);
  }
  if (pageAll === true) argv.push('--page-all');
  return { argv };
}

function runGws(argv, accessToken) {
  return new Promise((resolve) => {
    // path.delimiter: ':' on POSIX, ';' on Windows (a ':' join there would
    // corrupt the child's PATH).
    const env = { ...process.env, PATH: [EXEC_PATH, process.env.PATH || ''].join(path.delimiter) };
    // Env hygiene (Codex): if THIS server was launched from a shell that
    // carried a token or a Dobius account binding, a no-account call would
    // silently inherit that identity instead of the base gws one. Strip
    // identity-bearing vars; set the token only when we minted it.
    delete env.GOOGLE_WORKSPACE_CLI_TOKEN;
    delete env.DOBIUS_GWS_ACCOUNT;
    delete env.DOBIUS_GWS_ACCOUNT_ID;
    if (accessToken) env.GOOGLE_WORKSPACE_CLI_TOKEN = accessToken;
    const inv = gwsInvocation();
    if (inv.error) { resolve({ ok: false, text: inv.error }); return; }
    execFile(inv.file, [...inv.argsPrefix, ...argv], { env, timeout: GWS_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      let text = String(stdout || '');
      if (err && !text.trim()) text = String(stderr || err.message || 'gws failed');
      else if (err) text += `\n[gws exited with an error]\n${String(stderr || '').slice(0, 2000)}`;
      if (text.length > MAX_OUTPUT_CHARS) {
        text = `${text.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated at ${MAX_OUTPUT_CHARS} chars; narrow the query or use params like pageSize/fields]`;
      }
      resolve({ ok: !err, text });
    });
  });
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'gws_accounts',
    description: 'List the connected Google Workspace accounts this Mac can act as. Pass one of these emails as `account` to gws_call. Calls without an account run as the base gws identity.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'gws_call',
    description: 'Call any Google Workspace API through the gws CLI, as a chosen account. `command` is the positional path, e.g. ["gmail","users","messages","list"] or ["drive","files","get"]. Query/url parameters go in `params`, request bodies in `body`. Unknown APIs work via "service:version" as the first part. Use gws_schema first when unsure of a method\'s parameters. Read-heavy calls: prefer explicit params (pageSize, fields, q) to keep responses small.',
    inputSchema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Email of the connected account to act as (from gws_accounts). Omit for the base gws identity.' },
        command: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5, description: 'Positional gws parts: service, resource, [sub-resource], method' },
        params: { type: 'object', description: 'URL/query parameters' },
        body: { type: 'object', description: 'Request body for POST/PATCH/PUT methods' },
        apiVersion: { type: 'string', description: 'Override API version, e.g. "v2"' },
        format: { type: 'string', enum: ['json', 'table', 'yaml', 'csv'] },
        pageAll: { type: 'boolean', description: 'Auto-paginate (NDJSON, one page per line)' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'gws_schema',
    description: 'Describe a Google API method\'s parameters and request/response shape, e.g. "drive.files.list" or "gmail.users.messages.send". Use before an unfamiliar gws_call.',
    inputSchema: {
      type: 'object',
      properties: { method: { type: 'string', description: 'service.resource.method, dots only' } },
      required: ['method'],
      additionalProperties: false,
    },
  },
];

async function handleTool(name, args) {
  if (name === 'gws_accounts') {
    const accounts = listAccounts();
    return accounts.length
      ? `Connected accounts (pass as \`account\` to gws_call):\n${accounts.map((a) => `- ${a.email}`).join('\n')}`
      : 'No connected accounts found in ~/.gws-profiles. Connect accounts in Dobius+ Settings, or omit `account` to use the base gws identity.';
  }
  if (name === 'gws_schema') {
    const method = String(args?.method || '');
    if (!/^[A-Za-z0-9:_-]+(\.[A-Za-z0-9_-]+)+$/.test(method)) throw new Error('method must look like "drive.files.list"');
    const { text } = await runGws(['schema', method], null);
    return text;
  }
  if (name === 'gws_call') {
    const built = buildArgv(args || {});
    if (built.error) throw new Error(built.error);
    let token = null;
    if (args.account !== undefined) {
      if (typeof args.account !== 'string' || !args.account.includes('@')) throw new Error('account must be an email from gws_accounts');
      token = await mintToken(args.account); // throws rather than falling back
    }
    const { text } = await runGws(built.argv, token);
    return text;
  }
  throw new Error(`unknown tool ${name}`);
}

// ---------------------------------------------------------------------------
// MCP stdio plumbing (newline-delimited JSON-RPC 2.0)
// ---------------------------------------------------------------------------

function serveStdio() {
  const write = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch {
        // Spec behavior: a malformed frame gets a parse error, not silence
        // (a request/response client would otherwise hang). Codex Low.
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
        continue;
      }
      handleRpc(msg, write);
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

async function handleRpc(msg, write) {
  const { id, method, params } = msg;
  const reply = (result) => { if (id !== undefined) write({ jsonrpc: '2.0', id, result }); };
  const replyErr = (code, message) => { if (id !== undefined) write({ jsonrpc: '2.0', id, error: { code, message } }); };
  try {
    if (method === 'initialize') {
      reply({
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'gws-mcp', version: '1.0.0' },
      });
    } else if (method === 'notifications/initialized' || method === 'initialized') {
      // notification: no reply
    } else if (method === 'tools/list') {
      reply({ tools: TOOLS });
    } else if (method === 'tools/call') {
      try {
        const text = await handleTool(params?.name, params?.arguments || {});
        reply({ content: [{ type: 'text', text }] });
      } catch (e) {
        reply({ content: [{ type: 'text', text: `Error: ${e?.message || e}` }], isError: true });
      }
    } else if (method === 'ping') {
      reply({});
    } else if (id !== undefined) {
      replyErr(-32601, `method not found: ${method}`);
    }
  } catch (e) {
    replyErr(-32603, String(e?.message || e));
  }
}

// ---------------------------------------------------------------------------
// Standalone CLI (Windows-first, works everywhere): capture accounts and
// register in Claude Desktop WITHOUT the Dobius app. A Windows Claude Desktop
// user needs exactly: node + the gws CLI + this file (Sam, 8/18: "my brother
// runs on windows").
// ---------------------------------------------------------------------------

/** Claude Desktop's per-user config dir. Parameterized for tests. */
export function claudeDesktopDirFor(platform = process.platform, env = process.env, home = os.homedir()) {
  if (env.GWS_MCP_CLAUDE_DIR) return env.GWS_MCP_CLAUDE_DIR; // test override
  if (platform === 'win32') return env.APPDATA ? path.join(env.APPDATA, 'Claude') : null;
  return path.join(home, 'Library', 'Application Support', 'Claude');
}

/** Same merge semantics as the in-app installer: preserve, back up, refuse malformed. */
export function mergeClaudeConfig(existingText, entry) {
  let cfg = {};
  if (existingText !== null && existingText !== undefined && String(existingText).trim() !== '') {
    try { cfg = JSON.parse(existingText); } catch { return { error: 'claude_desktop_config.json exists but is not valid JSON. Fix or remove it, then retry.' }; }
    if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) return { error: 'claude_desktop_config.json has an unexpected shape. Fix it, then retry.' };
  }
  const servers = (typeof cfg.mcpServers === 'object' && cfg.mcpServers !== null && !Array.isArray(cfg.mcpServers)) ? cfg.mcpServers : {};
  return { next: { ...cfg, mcpServers: { ...servers, gws: entry } } };
}

function newProfileId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 24; i += 1) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `gws-${s}`;
}

/** Snapshot the CURRENTLY logged-in gws identity into ~/.gws-profiles. */
async function cliCapture() {
  const { text, ok } = await runGws(['auth', 'export', '--unmasked'], null);
  // NEVER echo the export output on failure: it can carry the unmasked
  // client_secret / refresh_token even when gws exits non-zero (Codex High).
  if (!ok) { console.error('capture failed: gws auth export did not succeed. Run `gws auth login` first, then retry.'); process.exit(1); }
  let exp;
  try { exp = JSON.parse(text); } catch { console.error('capture failed: gws auth export did not return JSON. Run `gws auth login` first.'); process.exit(1); }
  if (!exp?.refresh_token || !exp?.client_id || !exp?.client_secret) {
    console.error('capture failed: export is missing credentials. Run `gws auth login` first.');
    process.exit(1);
  }
  // Whose account is this? Prove it via userinfo on a freshly minted token.
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: exp.client_id, client_secret: exp.client_secret, refresh_token: exp.refresh_token, grant_type: 'refresh_token' }).toString(),
  });
  const tok = await r.json().catch(() => ({}));
  if (!tok.access_token) { console.error(`capture failed: Google rejected the exported credentials (${tok.error || r.status}).`); process.exit(1); }
  const ur = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const uj = await ur.json().catch(() => ({}));
  const email = typeof uj.email === 'string' ? uj.email : null;
  if (!email) { console.error('capture failed: could not read the account email (userinfo scope missing?).'); process.exit(1); }
  fs.mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 });
  // Refresh in place when this email already has a profile (keeps any id the
  // Dobius app registered); otherwise a fresh file.
  let file = null;
  for (const f of fs.readdirSync(PROFILES_DIR)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    try { if (String(JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf8')).email || '').toLowerCase() === email.toLowerCase()) { file = f; break; } } catch { /* skip */ }
  }
  if (!file) file = `${newProfileId()}.json`;
  const dest = path.join(PROFILES_DIR, file);
  fs.writeFileSync(dest, JSON.stringify({ client_id: exp.client_id, client_secret: exp.client_secret, refresh_token: exp.refresh_token, email }), { mode: 0o600 });
  try { fs.chmodSync(dest, 0o600); } catch { /* windows: no-op */ }
  console.log(`captured ${email}. Accounts now available: ${listAccounts().map((a) => a.email).join(', ')}`);
  console.log('To add another: gws auth login (pick the next account), then run --capture again.');
}

/** Register this file as the gws MCP server in Claude Desktop's config. */
function cliSetup() {
  const dir = claudeDesktopDirFor();
  if (!dir) { console.error('setup failed: could not locate the Claude Desktop config dir (APPDATA unset?).'); process.exit(1); }
  fs.mkdirSync(dir, { recursive: true });
  const cfgPath = path.join(dir, 'claude_desktop_config.json');
  let existing = null;
  try { existing = fs.readFileSync(cfgPath, 'utf8'); } catch { /* first setup */ }
  const self = fs.realpathSync(fileURLToPath(import.meta.url));
  const merged = mergeClaudeConfig(existing, { command: process.execPath, args: [self] });
  if (merged.error) { console.error(`setup failed: ${merged.error}`); process.exit(1); }
  if (existing !== null) {
    try { fs.writeFileSync(path.join(dir, `claude_desktop_config.backup-${Date.now()}.json`), existing); } catch { /* best effort */ }
  }
  const tmp = `${cfgPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(merged.next, null, 2)}\n`);
  fs.renameSync(tmp, cfgPath);
  console.log(`registered in ${cfgPath}`);
  console.log('Restart Claude Desktop to load the gws tools.');
}

/** One-look health report, for debugging a fresh machine over the phone. */
async function cliDoctor() {
  console.log(`platform: ${process.platform}, node: ${process.version}`);
  const inv = gwsInvocation();
  console.log(`gws: ${inv.error ? `MISSING (${inv.error})` : `ok (${inv.argsPrefix[0] || inv.file})`}`);
  if (!inv.error) {
    const { ok, text } = await runGws(['auth', 'status'], null);
    let who = null;
    try { who = JSON.parse(text.slice(text.indexOf('{'))).user || null; } catch { /* banner-only */ }
    console.log(`gws login: ${ok ? (who || 'logged in') : 'NOT LOGGED IN (run: gws auth login)'}`);
  }
  const accounts = listAccounts();
  console.log(`captured accounts (${accounts.length}): ${accounts.map((a) => a.email).join(', ') || '(none: run --capture after gws auth login)'}`);
  const dir = claudeDesktopDirFor();
  let entry = null;
  try { entry = JSON.parse(fs.readFileSync(path.join(dir, 'claude_desktop_config.json'), 'utf8'))?.mcpServers?.gws || null; } catch { /* absent */ }
  console.log(`claude desktop config: ${dir || '(unknown)'} -> gws entry ${entry ? 'present' : 'ABSENT (run --setup)'}`);
}

// Start only when run directly, so tests can import the pure helpers.
// Compare REAL paths, not URL strings: `file://${argv[1]}` fails on relative
// invocation and on paths with spaces (URL-encoding), which silently produced
// a server that never spoke.
let runDirect = false;
try {
  runDirect = !!process.argv[1]
    && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
} catch { /* argv[1] unreadable: not us */ }
if (runDirect) {
  const mode = process.argv[2];
  if (mode === '--capture') await cliCapture();
  else if (mode === '--setup') cliSetup();
  else if (mode === '--doctor') await cliDoctor();
  else if (mode) { console.error(`unknown option ${mode}. Use --capture, --setup, --doctor, or no arguments to serve MCP.`); process.exit(2); }
  else serveStdio();
}
