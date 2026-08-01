/**
 * Mobile server: embedded HTTP + WebSocket server that bridges Dobius+ to a
 * phone PWA over the user's Tailscale tailnet.
 *
 * Phase 1: server lifecycle, Tailscale-only binding, and the pairing flow.
 * The terminal bridge protocol is added in Phase 2.
 *
 * Security model:
 *  - Binds ONLY to the Mac's tailnet IP (100.64.0.0/10), never 0.0.0.0 or LAN.
 *    If there's no tailnet address the server refuses to start.
 *  - A phone pairs once with an ephemeral 6-digit code, then receives a
 *    long-lived device token. The token is required on every WebSocket connect.
 *  - The pairing code is brute-force-limited: 5 bad attempts invalidate it
 *    until the user regenerates it from the desktop.
 */
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import os from 'os';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app, powerSaveBlocker } from 'electron';
import { getMobileServerConfig, updateMobileServerConfig, setSessionTabLink, removePushSubscriptionsByToken, getSessionTabMap } from './config-manager.js';
import {
  listTerminals, subscribeTerminal, writeTerminal, terminalHasDesktopAttached,
  resizeTerminal, killTerminal, createTerminal,
} from './terminal-manager.js';
import { loadAllSessions, loadTranscript, listProjects } from './data-service.js';
import { peekReply } from './voice-bridge.js';
import { getVoiceConductorTabId } from './voice-conductor.js';
import { snapshot as terminalStatusSnapshot } from './terminal-status.js';
import { estimateContextForTabId } from './tab-context.js';
import { getMagicDNSName, certPathsFor, hasCertFor } from './tailscale.js';
import { transcribeAudio, transcribeAvailable } from './voice-transcribe.js';
import { getVapidPublicKey, subscribePush, sendPush, hasPushSubscribers } from './push.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_PAIR_ATTEMPTS = 5;
const PAIR_LOCK_MS = 60000;  // cooldown after MAX_PAIR_ATTEMPTS, then re-arm
const AUTH_TIMEOUT_MS = 5000;
const MAX_INPUT_BYTES = 100 * 1024;   // cap a single input message (paste)
const MAX_WS_PAYLOAD = 1024 * 1024;   // 1MB ws frame ceiling
// whisper + ffmpeg are CPU-heavy; only run a couple at once so a retry loop or a
// burst of uploads can't stack processes and starve the Mac. Audit HIGH-4.
const MAX_VOICE_INFLIGHT = 2;

let httpServer = null;
let wss = null;
let pairingCode = null;   // ephemeral, regenerated on each start
let pairAttempts = 0;
let pairLockedUntil = 0;  // epoch ms; refuse pairing until then after a flood
let voiceInFlight = 0;    // concurrent /voice/audio transcriptions

// Power assertion (v1.0.43 resilience): while the mobile server is up, keep the
// Mac from suspending so a phone away from home does not lose the link to a
// sleeping Mac. `prevent-app-suspension` keeps CPU/network alive but still lets
// the DISPLAY sleep (this is a headless-remote scenario). Highest-leverage
// disconnect fix (REMOTE-CONTROL-PLAN resilience section).
let powerBlockerId = null;
function startPowerAssertion() {
  try {
    if (powerBlockerId === null || !powerSaveBlocker.isStarted(powerBlockerId)) {
      powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
  } catch (e) {
    console.warn('[mobile-server] powerSaveBlocker start failed:', e?.message || e);
    powerBlockerId = null;
  }
}
function stopPowerAssertion() {
  try {
    if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
      powerSaveBlocker.stop(powerBlockerId);
    }
  } catch { /* best effort */ }
  powerBlockerId = null;
}
let boundAddress = null;  // { host, port }
let serveInfo = null;     // { secure, url }: how clients should reach us (v1.0.43 Phase 4)

/** Find the Mac's Tailscale (CGNAT 100.64.0.0/10) IPv4 address, or null. */
function getTailnetIp() {
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        const [o1, o2] = a.address.split('.').map(Number);
        if (o1 === 100 && o2 >= 64 && o2 <= 127) return a.address;
      }
    }
  }
  return null;
}

function genPairingCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function knownToken(token) {
  if (!token || typeof token !== 'string') return false;
  return getMobileServerConfig().devices.some((d) => d.token === token);
}

// Compute the public-facing opaque deviceId for a device. Stored deviceId
// wins (post-v1.0.28 devices). Legacy entries without one get a deterministic
// SHA-256-derived id so the UI/removal path agrees with listDevices on the
// same value. Single source of truth: BOTH listDevices AND removeMobileDevice
// must use this helper or removal silently no-ops on legacy entries.
// Codex v1.0.28 round-1 HIGH.
export function deriveDeviceId(device) {
  if (device?.deviceId) return device.deviceId;
  if (!device?.token) return null;
  return `legacy-${crypto.createHash('sha256').update(device.token).digest('hex').slice(0, 16)}`;
}

// Active authenticated WebSocket sessions, keyed by token, so removeMobileDevice
// can forcibly close every live socket for a revoked device instead of leaving
// pre-revocation connections authorized until they disconnect on their own.
// Codex v1.0.28 HIGH (mobile-server.js:400).
const activeSocketsByToken = new Map(); // token -> Set<WebSocket>

/** Send a JSON message on a WebSocket if it's still open. */
function wsSend(socket, obj) {
  if (socket.readyState === 1) {
    try { socket.send(JSON.stringify(obj)); } catch { /* noop */ }
  }
}

/**
 * Handle a message from an authenticated phone client. The terminal bridge:
 * the phone attaches to live PTYs, streams their output, and writes input
 * back to the same shells the desktop uses.
 *
 * Access policy: any paired device may input/resize/kill any terminal without
 * a prior attach. This is intentional for a single-user personal tool (one
 * user, one tailnet, one Mac). If multi-user pairing is ever added, this needs
 * an attach-before-operate gate.
 */
// Parse a terminal id into a friendly project + tab label (mirrors the mobile
// Terminal.jsx parser and terminal-status.projectFromId).
function parseTermLabel(id, cwd) {
  const m = typeof id === 'string' && id.match(/^term-(.+)-(\d+)$/);
  if (m && m[1] !== 'mobile') {
    const projectPath = m[1];
    return { projectPath, projectName: projectPath.split('/').filter(Boolean).pop() || projectPath, label: `Tab ${m[2]}` };
  }
  const projectPath = cwd || 'mobile';
  return { projectPath, projectName: projectPath.split('/').filter(Boolean).pop() || 'mobile', label: 'new' };
}

// Per-tab context (model + ctx%) cache, refreshed on a slow debounce because it
// is transcript-file derived, not PTY-evented. v1.0.43 Phase 3b.
const tabContextCache = new Map(); // id -> { model, ctxPct }
let contextRefreshTimer = null;
async function refreshTabContexts() {
  try {
    const live = listTerminals();
    const liveIds = new Set(live.map((t) => t.id));
    for (const id of [...tabContextCache.keys()]) {
      if (!liveIds.has(id)) tabContextCache.delete(id);
    }
    for (const t of live) {
      const ctx = await estimateContextForTabId(t.id);
      if (ctx && ctx.maxTokens > 0) {
        tabContextCache.set(t.id, {
          model: shortModel(ctx.model),
          ctxPct: Math.min(100, Math.round((ctx.tokens / ctx.maxTokens) * 100)),
        });
      } else {
        tabContextCache.delete(t.id);
      }
    }
  } catch { /* best effort */ }
}

// Short, human model label (claude-opus-4-8 -> "opus", claude-sonnet-5 -> "sonnet").
function shortModel(model) {
  if (typeof model !== 'string') return '';
  const m = model.match(/(opus|sonnet|haiku|fable)/i);
  return m ? m[1].toLowerCase() : '';
}

// The status-rich terminals payload for the mobile board: live terminals merged
// with the main-process status authority + the context cache + the recent-exit
// cache. v1.0.43.
function buildTerminalsPayload() {
  const snap = terminalStatusSnapshot();
  // Reverse the session<->tab map (cheap, sync) so each tab carries its linked
  // session. The mobile Chat view loads that session's transcript to show a
  // responsive conversation instead of the width-locked raw terminal mirror.
  const tabMap = getSessionTabMap() || {};
  const sessionByTab = new Map();
  for (const [sid, link] of Object.entries(tabMap)) {
    if (!link || typeof link !== 'object' || !link.tabId) continue;
    const at = link.lastRunningAt || link.capturedAt || 0;
    const prev = sessionByTab.get(link.tabId);
    if (!prev || at >= prev.at) sessionByTab.set(link.tabId, { sessionId: sid, projectPath: link.projectPath, at });
  }
  const list = listTerminals().map((t) => {
    const meta = parseTermLabel(t.id, t.cwd);
    const st = snap.live[t.id];
    const ctx = tabContextCache.get(t.id);
    const link = sessionByTab.get(t.id);
    return {
      id: t.id,
      pid: t.pid,
      cwd: t.cwd,
      projectPath: meta.projectPath,
      projectName: meta.projectName,
      label: meta.label,
      status: st?.status || 'idle',
      lastActivityAt: st?.lastActivityAt || 0,
      model: ctx?.model || '',
      ctxPct: typeof ctx?.ctxPct === 'number' ? ctx.ctxPct : null,
      sessionId: link?.sessionId || null,
      sessionProject: link?.projectPath || null,
    };
  });
  return { type: 'terminals', list, recentExits: snap.recentExits };
}

// A signature capturing what the BOARD cares about (which tabs exist, their
// status, recent exits) but NOT lastActivityAt, so an actively-printing tab
// does not trigger a push every second. We only push when this changes.
// Codex remote-plan #2 (send deltas only when serialized status changes).
function terminalsSignature(payload) {
  // Bucket ctx% to 5% so a slowly-growing context does not push every refresh,
  // but a meaningful move (and model changes) still updates the ring.
  const tabs = payload.list
    .map((t) => `${t.id}:${t.status}:${t.model}:${t.sessionId || ''}:${t.ctxPct == null ? '' : Math.round(t.ctxPct / 5)}`)
    .sort().join('|');
  const exits = payload.recentExits.map((e) => `${e.id}:${e.exitCode}:${e.at}`).join('|');
  return `${tabs}#${exits}`;
}

let statusBroadcastTimer = null;
let lastTerminalsSig = null;
const prevStatusById = new Map(); // id -> last status, for push transitions
const notifiedExits = new Set();  // `${id}:${at}` already push-notified
const NOTIFIED_EXITS_CAP = 200;   // > MAX_RECENT_EXITS (50) so cached exits never evict

// Fire push notifications for the moments worth pulling Sam back: a session
// starts needing input, or a session exits nonzero. Runs even with no phone
// connected (that is the point of push), but only when there are subscribers.
// v1.0.43 Phase 5b.
function firePushForEvents(payload) {
  if (!hasPushSubscribers()) {
    // Still track state so we don't blast a backlog the moment someone subscribes.
    for (const t of payload.list) prevStatusById.set(t.id, t.status);
    return;
  }
  const seen = new Set();
  for (const t of payload.list) {
    seen.add(t.id);
    const prev = prevStatusById.get(t.id);
    if (t.status === 'needs' && prev !== 'needs') {
      // url carries ?open=<id> so tapping the notification deep-links straight to
      // the session that needs input, not just whatever screen was last open.
      // Audit MED-12.
      sendPush({
        title: t.projectName || 'Dobius+',
        body: `${t.label} needs your input`,
        tag: `needs:${t.id}`,
        url: `./?open=${encodeURIComponent(t.id)}`,
      });
    }
    prevStatusById.set(t.id, t.status);
  }
  for (const id of [...prevStatusById.keys()]) if (!seen.has(id)) prevStatusById.delete(id);
  for (const e of payload.recentExits) {
    if (typeof e.exitCode === 'number' && e.exitCode !== 0) {
      const key = `${e.id}:${e.at}`;
      if (!notifiedExits.has(key)) {
        notifiedExits.add(key);
        sendPush({ title: e.projectName || 'Dobius+', body: `session failed (exit ${e.exitCode})`, tag: `exit:${key}` });
      }
    }
  }
  // Bound notifiedExits WITHOUT dropping keys still present in recentExits: a
  // full .clear() emptied the dedup set while terminal-status.recentExits (a
  // 50-entry FIFO) still held those exits, so the next tick re-fired up to 50
  // duplicate "session failed" pushes. Set is insertion-ordered, so evict oldest
  // first and keep a window well above MAX_RECENT_EXITS (50), which guarantees
  // the still-cached exits are never among the evicted. Audit MED-7.
  while (notifiedExits.size > NOTIFIED_EXITS_CAP) {
    notifiedExits.delete(notifiedExits.values().next().value);
  }
}

// Seed the push dedup state from the CURRENT status snapshot so a server
// (re)start does not re-notify sessions that already need input or already
// exited. prevStatusById/notifiedExits are cleared on stop, but
// terminal-status.recentExits (module-level, 50-entry FIFO) survives, so without
// this the first tick after a restart (bind-mode change, cert provision) blasted
// stale "session failed" + "needs input" pushes. Audit MED-6.
function seedPushBaseline() {
  const payload = buildTerminalsPayload();
  prevStatusById.clear();
  notifiedExits.clear();
  for (const t of payload.list) prevStatusById.set(t.id, t.status);
  for (const e of payload.recentExits) {
    if (typeof e.exitCode === 'number' && e.exitCode !== 0) notifiedExits.add(`${e.id}:${e.at}`);
  }
}

function pollStatusTick() {
  const payload = buildTerminalsPayload();
  // Push events fire regardless of connected sockets (phone may be closed).
  try { firePushForEvents(payload); } catch { /* best effort */ }
  // WS broadcast only when a phone is connected and the board-relevant state moved.
  if (activeSocketsByToken.size === 0) return;
  const sig = terminalsSignature(payload);
  if (sig === lastTerminalsSig) return;
  lastTerminalsSig = sig;
  for (const set of activeSocketsByToken.values()) {
    for (const s of set) { try { wsSend(s, payload); } catch { /* dropped socket */ } }
  }
}

// Known projects the phone may spawn a terminal in: manual + session-bearing
// projects (via listProjects().decodedPath). Used for the picker AND as the
// createTerminal allowlist, so a paired token cannot spawn a shell in an
// arbitrary cwd. Codex remote-plan #5.
async function knownProjectList() {
  try {
    const projs = await listProjects();
    return (projs || [])
      .map((p) => p.decodedPath)
      .filter((pth) => typeof pth === 'string' && pth)
      .map((pth) => ({ path: pth, name: pth.split('/').filter(Boolean).pop() || pth }));
  } catch {
    return [];
  }
}
async function isKnownProjectPath(pth) {
  if (typeof pth !== 'string' || !pth) return false;
  return (await knownProjectList()).some((p) => p.path === pth);
}

// The ONLY non-path cwd values that map to the home dir: the desktop main tab
// and phone-tab sentinels (and empty = no project). Everything else that is not
// a known absolute project path is rejected, so `.`, `~`, `foo`, etc. cannot
// get a home shell. Codex Phase 3a P2 (tightened from "any non-absolute").
const HOME_SENTINELS = new Set(['', 'main', 'mobile']);
async function resolveCreateCwd(cwd) {
  const v = typeof cwd === 'string' ? cwd : '';
  if (HOME_SENTINELS.has(v)) return os.homedir();
  if (v.startsWith('/') && (await isKnownProjectPath(v))) return v;
  return null;
}

// Route a transcript to the Voice Conductor, tagged with a per-request id so
// /voice/reply can match the spoken reply. Returns the requestId, or null if
// the Conductor is offline. Shared by /voice/intent and /voice/audio.
function routeToConductor(transcript) {
  const conductorId = getVoiceConductorTabId();
  if (!conductorId || !listTerminals().some((t) => t.id === conductorId)) return null;
  const requestId = `req-${crypto.randomBytes(6).toString('hex')}`;
  const tagged = `[${requestId}] ${transcript.slice(0, 4000).replace(/[\r\n]+/g, ' ')}`;
  const CHUNK = 256;
  for (let i = 0; i < tagged.length; i += CHUNK) writeTerminal(conductorId, tagged.slice(i, i + CHUNK));
  writeTerminal(conductorId, '\r');
  return requestId;
}

// Monotonic per-session counter for phone-spawned terminal ids. Must stay the
// shape `term-mobile-<n>` (a single trailing digit run) because every parser
// (parseTermLabel, terminal-status.projectFromId, mobile/Terminal.jsx) matches
// `/^term-(.+)-(\d+)$/` and treats the terminal as mobile ONLY when the middle
// group is exactly "mobile" (a `term-mobile-<ts>-<n>` shape would break that,
// grouping it under a fake project). A plain incrementing counter is unique
// within a session (PTYs never survive a restart) and never reuses an id, which
// fixes the `Date.now()` collision that let two same-millisecond spawns kill
// each other's PTY. Audit MED-10 + Codex.
let mobileTermCounter = 0;
function mobileTermId() {
  mobileTermCounter += 1;
  return `term-mobile-${mobileTermCounter}`;
}

function handleAuthedMessage(socket, msg, subs) {
  switch (msg.type) {
    case 'ping':
      wsSend(socket, { type: 'pong' });
      break;

    case 'listTerminals':
      wsSend(socket, buildTerminalsPayload());
      break;

    case 'attach': {
      const id = msg.id;
      if (typeof id !== 'string' || subs.has(id)) break;
      const sink = {
        onData: (tid, data) => wsSend(socket, { type: 'output', id: tid, data }),
        onExit: (tid, code, signal) => {
          // onExit can fire after the socket already closed (close cleanup
          // ran first). wsSend's readyState guard makes that a safe no-op.
          wsSend(socket, { type: 'exit', id: tid, code, signal });
          const u = subs.get(tid);
          if (u) { u(); subs.delete(tid); }
        },
      };
      const { ok, unsubscribe, buffer } = subscribeTerminal(id, sink);
      if (!ok) {
        // The terminal exited between the board listing it and this attach. Tell
        // the phone so it refreshes its list instead of showing a live-looking
        // blank terminal that silently swallows keystrokes. Audit MED-9.
        wsSend(socket, { type: 'terminalMissing', id });
        break;
      }
      subs.set(id, unsubscribe);
      // Replay recent output so the phone sees the current screen, not a blank.
      if (buffer) wsSend(socket, { type: 'output', id, data: buffer, replay: true });
      wsSend(socket, { type: 'attached', id });
      break;
    }

    case 'detach': {
      const u = subs.get(msg.id);
      if (u) { u(); subs.delete(msg.id); }
      break;
    }

    case 'input':
      if (typeof msg.id === 'string' && typeof msg.data === 'string'
          && msg.data.length <= MAX_INPUT_BYTES) {
        writeTerminal(msg.id, msg.data);
      }
      break;

    case 'resize':
      if (typeof msg.id === 'string'
          && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)
          && msg.cols > 0 && msg.rows > 0) {
        // If a desktop window is driving this PTY, ignore phone-side resize.
        // Reshaping the PTY to phone dimensions makes TUI apps repaint at the
        // smaller geometry, which mangles the desktop xterm. Phone-only PTYs
        // (e.g. ones created via `createTerminal` from mobile) still get
        // resized normally.
        if (!terminalHasDesktopAttached(msg.id)) {
          resizeTerminal(msg.id, msg.cols, msg.rows);
        }
      }
      break;

    case 'kill':
      if (typeof msg.id === 'string') killTerminal(msg.id);
      break;

    case 'listProjects':
      knownProjectList()
        .then((list) => wsSend(socket, { type: 'projects', list }))
        .catch(() => wsSend(socket, { type: 'projects', list: [] }));
      break;

    case 'createTerminal': {
      // Phone-spawned PTY (no desktop tab; labeled remote-only on the board).
      // The cwd MUST be a known project (allowlist), never an arbitrary path,
      // so a paired token cannot open a shell anywhere on disk. Codex #5.
      resolveCreateCwd(msg.cwd).then((resolved) => {
        if (resolved === null) {
          wsSend(socket, { type: 'error', message: 'Unknown project' });
          return;
        }
        const id = mobileTermId();
        try {
          createTerminal(id, resolved, null);
          wsSend(socket, { type: 'terminalCreated', id });
        } catch (err) {
          wsSend(socket, { type: 'error', message: String(err?.message || err) });
        }
      });
      break;
    }

    case 'listSessions':
      loadAllSessions()
        .then((list) => wsSend(socket, { type: 'sessions', list: list || [] }))
        .catch((err) => wsSend(socket, { type: 'error', message: String(err?.message || err) }));
      break;

    case 'loadTranscript': {
      const { sessionId, projectPath } = msg;
      if (typeof sessionId !== 'string' || typeof projectPath !== 'string') break;
      loadTranscript(sessionId, projectPath)
        .then((entries) => wsSend(socket, { type: 'transcript', sessionId, projectPath, entries: entries || [] }))
        .catch((err) => wsSend(socket, { type: 'error', message: String(err?.message || err) }));
      break;
    }

    case 'resumeSession': {
      // Open a phone terminal in the session's project and resume Claude there.
      const { sessionId, projectPath } = msg;
      if (typeof sessionId !== 'string' || !/^[\w-]+$/.test(sessionId)) break;
      // Route the cwd through the SAME allowlist createTerminal uses. Without
      // this, resumeSession took projectPath verbatim and spawned a login shell
      // in any directory the phone named (audit HIGH-2), and an unknown path
      // silently fell back to a home-dir shell + a blind `claude --resume` in
      // the wrong place. Unknown project -> error, no shell.
      resolveCreateCwd(projectPath).then((cwd) => {
        if (cwd === null) {
          wsSend(socket, { type: 'error', message: 'Unknown project' });
          return;
        }
        const id = mobileTermId();
        try {
          createTerminal(id, cwd, null);
          wsSend(socket, { type: 'terminalCreated', id });
          // Link the session to this tab so the sidebar shows where it resumed.
          setSessionTabLink(sessionId, id, cwd);
          // Give the shell a beat to print its prompt before sending the command.
          setTimeout(() => writeTerminal(id, `claude --resume ${sessionId}\r`), 700);
        } catch (err) {
          wsSend(socket, { type: 'error', message: String(err?.message || err) });
        }
      });
      break;
    }

    default:
      break;
  }
}

/** Current server status, safe to expose to the renderer. */
export function getMobileServerStatus() {
  return {
    running: !!httpServer,
    tailnetIp: getTailnetIp(),
    address: boundAddress,
    secure: serveInfo?.secure || false,
    url: serveInfo?.url || null,
    pairingCode: httpServer ? pairingCode : null,
    deviceCount: getMobileServerConfig().devices.length,
  };
}

/** Start the server. Resolves to a status object (with `error` set on failure). */
export async function startMobileServer() {
  if (httpServer) return getMobileServerStatus();

  const cfg = getMobileServerConfig();
  // Tailscale-only: bind to the 100.x tailnet IP so the server is reachable
  // ONLY from tailnet peers (never the local subnet) and all traffic rides the
  // WireGuard tunnel. This is what keeps the bearer token off the wire in the
  // clear. LAN/plaintext mode was removed in v1.0.43 (it was an RCE path).
  const ip = getTailnetIp();
  if (!ip) {
    return {
      running: false,
      error: 'No Tailscale connection found. Open Tailscale, sign in, then try again.',
    };
  }
  const port = cfg.port || 8420;

  const expApp = express();
  expApp.use(express.json({ limit: '64kb' }));

  expApp.get('/health', (_req, res) => {
    res.json({ ok: true, app: 'dobius-plus', version: app.getVersion() });
  });

  expApp.post('/pair', (req, res) => {
    // Time-boxed cooldown after a wrong-guess flood, NOT a permanent lockout. The
    // old code nulled pairingCode on the 5th miss, so any unauthenticated caller
    // who could reach the server could deny pairing forever (and re-lock right
    // after a manual regenerate). Now the code stays valid and we just refuse
    // attempts for PAIR_LOCK_MS, then re-arm, so a flood can only stall pairing
    // for a minute at a time. Audit MED-8.
    const now = Date.now();
    if (pairLockedUntil > now) {
      return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in a minute.' });
    }
    if (!pairingCode) {
      return res.status(403).json({ ok: false, error: 'Pairing is locked. Regenerate the code on the desktop.' });
    }
    const { code, deviceName } = req.body || {};
    if (code !== pairingCode) {
      pairAttempts += 1;
      if (pairAttempts >= MAX_PAIR_ATTEMPTS) {
        // Cooldown (rate limit) AND rotate the code. The rate limit caps guesses
        // to 5/min; rotating a fresh code each cycle means those guesses can't
        // accumulate against one fixed target (which would eventually be brute-
        // forced), while pairing still works with the current desktop-shown code
        // once the cooldown passes. Not a permanent lockout. Audit MED-8 + Codex.
        pairLockedUntil = now + PAIR_LOCK_MS;
        pairAttempts = 0;
        pairingCode = genPairingCode();
      }
      return res.status(403).json({ ok: false, error: 'Invalid pairing code.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    // Stable opaque device id used by the UI for listing + removal targeting.
    // Tokens stay server-side only — Codex v1.0.28 HIGH (main.js:987).
    const deviceId = crypto.randomBytes(8).toString('hex');
    const cfg = getMobileServerConfig();
    const devices = [...cfg.devices, {
      token,
      deviceId,
      name: typeof deviceName === 'string' && deviceName.trim() ? deviceName.trim().slice(0, 60) : 'Phone',
      pairedAt: Date.now(),
    }];
    updateMobileServerConfig({ devices });
    // Consume the code after a successful pair so it can't be reused.
    pairingCode = genPairingCode();
    pairAttempts = 0;
    pairLockedUntil = 0;
    res.json({ ok: true, token });
  });

  // ----- Voice Conductor endpoints (Siri / glasses entry point) -----
  // Auth: Bearer token in the Authorization header, same token issued at /pair.
  function bearerOk(req) {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer\s+([0-9a-f]{64})$/i);
    return m && knownToken(m[1]);
  }
  // The validated bearer token (or null), so push subscriptions can be bound to
  // the paired device. Only call after bearerOk(req) has passed.
  function bearerToken(req) {
    const m = (req.headers.authorization || '').match(/^Bearer\s+([0-9a-f]{64})$/i);
    return m ? m[1] : null;
  }

  // POST /voice/intent  { transcript: string, tabId?: string }
  // Two modes:
  //   1. Conductor (default): omit tabId. Routes through the Voice Conductor
  //      (Opus) which decides what to do. Smart but slower (~3-5s).
  //   2. Direct: pass tabId of any live Dobius+ terminal tab. The transcript
  //      is typed straight into that tab — no Conductor involved, no req-id
  //      tagging, no reply expected. Fast and dumb. Useful when you already
  //      know exactly which tab you want to talk to.
  expApp.post('/voice/intent', (req, res) => {
    if (!bearerOk(req)) return res.status(401).json({ ok: false, error: 'auth' });
    const transcript = req.body?.transcript;
    const directTabId = req.body?.tabId;
    if (typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ ok: false, error: 'transcript required' });
    }
    // Direct mode — write straight into the named tab, skip Conductor.
    if (typeof directTabId === 'string' && directTabId) {
      if (!/^term-.+-\d+$/.test(directTabId)) {
        return res.status(400).json({ ok: false, error: 'tabId malformed' });
      }
      if (!listTerminals().some((t) => t.id === directTabId)) {
        return res.status(404).json({ ok: false, error: 'tabId not alive' });
      }
      const text = transcript.slice(0, 4000).replace(/[\r\n]+/g, ' ');
      const CHUNK = 256;
      for (let i = 0; i < text.length; i += CHUNK) writeTerminal(directTabId, text.slice(i, i + CHUNK));
      writeTerminal(directTabId, '\r');
      // No requestId for direct mode — there's no Conductor to reply.
      return res.json({ ok: true, mode: 'direct', tabId: directTabId });
    }
    // Conductor mode (default): route via the shared helper, tagged with a
    // per-request id so /voice/reply can match the reply. 503 if offline.
    const requestId = routeToConductor(transcript);
    if (!requestId) return res.status(503).json({ ok: false, error: 'conductor offline' });
    res.json({ ok: true, mode: 'conductor', requestId });
  });

  // POST /voice/audio  (raw recorded audio body; Bearer auth)
  // The in-app voice path (v1.0.43 Phase 5): the phone records a command, uploads
  // it here, the Mac transcribes locally with whisper.cpp, and the text routes to
  // the Voice Conductor. Returns the transcript (so the phone shows what was
  // heard) plus a requestId to poll /voice/reply. Audio never leaves the Mac.
  expApp.post('/voice/audio', express.raw({ type: () => true, limit: '8mb' }), async (req, res) => {
    if (!bearerOk(req)) return res.status(401).json({ ok: false, error: 'auth' });
    if (!transcribeAvailable()) {
      return res.status(503).json({ ok: false, error: 'Local transcription is not set up on the Mac (whisper-cli / ffmpeg missing).' });
    }
    const audio = Buffer.isBuffer(req.body) ? req.body : null;
    if (!audio || audio.length === 0) return res.status(400).json({ ok: false, error: 'no audio' });
    // Concurrency cap: reject rather than stack CPU-heavy transcriptions (audit HIGH-4).
    if (voiceInFlight >= MAX_VOICE_INFLIGHT) {
      return res.status(429).json({ ok: false, error: 'Busy transcribing, try again in a moment.' });
    }
    voiceInFlight += 1;
    // Abort ffmpeg/whisper if the phone drops the request mid-transcription, so
    // orphaned children don't keep burning CPU + holding temp files (audit HIGH-4).
    const ac = new AbortController();
    const onClose = () => { if (!res.writableEnded) ac.abort(); };
    res.on('close', onClose);
    try {
      const result = await transcribeAudio(audio, req.headers['content-type'], ac.signal);
      if (ac.signal.aborted) return; // client already gone; nothing to send
      if (result.error) return res.status(422).json({ ok: false, error: result.error });
      const requestId = routeToConductor(result.text); // null if Conductor offline
      // Transcription succeeded either way, but be honest about whether the
      // command was actually routed, so the phone doesn't imply it was handled
      // when the Conductor is down. Codex Phase 5a P2.
      res.json({ ok: true, transcript: result.text, requestId, routed: !!requestId });
    } finally {
      voiceInFlight -= 1;
      res.off('close', onClose);
    }
  });

  // GET /push/vapid -> { publicKey }  (Bearer). The phone needs this to
  // subscribe to Web Push. v1.0.43 Phase 5b.
  expApp.get('/push/vapid', (req, res) => {
    if (!bearerOk(req)) return res.status(401).json({ ok: false, error: 'auth' });
    res.json({ ok: true, publicKey: getVapidPublicKey() });
  });

  // POST /push/subscribe { subscription }  (Bearer). Stores the phone's
  // PushSubscription so the Mac can notify it when a session needs input / fails.
  expApp.post('/push/subscribe', (req, res) => {
    if (!bearerOk(req)) return res.status(401).json({ ok: false, error: 'auth' });
    const entry = subscribePush(req.body?.subscription, bearerToken(req));
    if (!entry) return res.status(400).json({ ok: false, error: 'invalid subscription' });
    res.json({ ok: true });
  });

  // GET /voice/tabs
  // Returns the live Dobius+ terminal tab list for the iPhone Shortcut's
  // "Choose From List" step when the user wants direct-to-tab mode.
  expApp.get('/voice/tabs', (req, res) => {
    if (!bearerOk(req)) return res.status(401).json({ ok: false, error: 'auth' });
    // Strip term-/path/N → friendly label so the Shortcut shows readable names.
    const tabs = listTerminals().map((t) => {
      const m = t.id.match(/^term-(.+)-(\d+)$/);
      const projectPath = m ? m[1] : '';
      const tabNum = m ? m[2] : '';
      const projName = projectPath.split('/').filter(Boolean).pop() || 'unknown';
      return { id: t.id, label: `${projName} • ${tabNum}`, cwd: t.cwd };
    });
    res.json({ ok: true, tabs });
  });

  // POST /voice/reply  { requestId: string, timeoutMs?: number }
  // Long-polls (up to timeoutMs, default 25s) for the Conductor's reply to
  // the specific requestId. Returns the spoken message when it lands.
  expApp.post('/voice/reply', async (req, res) => {
    if (!bearerOk(req)) return res.status(401).json({ ok: false, error: 'auth' });
    const requestId = req.body?.requestId;
    if (typeof requestId !== 'string') {
      return res.status(400).json({ ok: false, error: 'requestId required' });
    }
    const timeoutMs = Math.min(Math.max(Number(req.body?.timeoutMs) || 25000, 1000), 60000);
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const r = peekReply(requestId);
      if (r) return res.json({ ok: true, reply: r.message, ts: r.ts });
      if (Date.now() >= deadline) return res.json({ ok: false, reason: 'timeout' });
      setTimeout(tick, 200);
    };
    tick();
  });

  // Serve the mobile PWA build if present (added in Phase 3), else a placeholder.
  const mobileDist = path.join(__dirname, '..', 'dist-mobile');
  if (fs.existsSync(path.join(mobileDist, 'index.html'))) {
    expApp.use(express.static(mobileDist));
  } else {
    expApp.get('/', (_req, res) => {
      res.type('html').send(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<body style="font-family:-apple-system;background:#0D1117;color:#E6EDF3;padding:2rem">'
        + '<h2>Dobius+ Mobile</h2><p>Server is running. The mobile app ships in a later update.</p></body>'
      );
    });
  }

  // HTTPS when a tailnet cert exists for our MagicDNS name (Phase 4): required
  // for service-worker install + Web Push (a browser secure context). The client
  // then uses the https MagicDNS URL (which resolves via MagicDNS to this tailnet
  // IP). Without a cert we fall back to plain HTTP, which is terminal-only (no
  // push/install). That HTTP fallback is safe here BECAUSE it rides the tailnet:
  // WireGuard already encrypts the transport, so the bearer token is not exposed
  // to a same-subnet sniffer the way the removed LAN/plaintext mode exposed it.
  let magicName = null;
  let secure = false;
  magicName = await getMagicDNSName();
  if (magicName && hasCertFor(magicName)) {
    const cp = certPathsFor(magicName);
    try {
      httpServer = https.createServer(
        { cert: fs.readFileSync(cp.certFile), key: fs.readFileSync(cp.keyFile) },
        expApp,
      );
      secure = true;
    } catch (e) {
      console.warn('[mobile-server] cert unreadable, falling back to HTTP:', e?.message || e);
    }
  }
  if (!httpServer) httpServer = http.createServer(expApp);
  const pendingServeInfo = {
    secure,
    url: secure ? `https://${magicName}:${port}/` : `http://${ip}:${port}/`,
  };

  wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: MAX_WS_PAYLOAD });
  wss.on('connection', (socket) => {
    let authed = false;
    let authedToken = null; // remembered so cleanup + revocation lookup work
    const subs = new Map(); // terminalId -> unsubscribe fn
    const authTimer = setTimeout(() => { if (!authed) socket.close(4001, 'auth timeout'); }, AUTH_TIMEOUT_MS);

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!authed) {
        if (msg.type === 'auth' && knownToken(msg.token)) {
          authed = true;
          authedToken = msg.token;
          clearTimeout(authTimer);
          // Register so removeMobileDevice can force-disconnect us if revoked.
          let set = activeSocketsByToken.get(authedToken);
          if (!set) { set = new Set(); activeSocketsByToken.set(authedToken, set); }
          set.add(socket);
          wsSend(socket, { type: 'authed', version: app.getVersion() });
        } else {
          socket.close(4003, 'unauthorized');
        }
        return;
      }
      handleAuthedMessage(socket, msg, subs);
    });

    const cleanup = () => {
      clearTimeout(authTimer);
      for (const unsubscribe of subs.values()) {
        try { unsubscribe(); } catch { /* noop */ }
      }
      subs.clear();
      if (authedToken) {
        const set = activeSocketsByToken.get(authedToken);
        if (set) {
          set.delete(socket);
          if (set.size === 0) activeSocketsByToken.delete(authedToken);
        }
      }
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });

  pairingCode = genPairingCode();
  pairAttempts = 0;
  pairLockedUntil = 0;

  return new Promise((resolve) => {
    const onError = (err) => {
      httpServer = null;
      wss = null;
      boundAddress = null;
      serveInfo = null;
      pairingCode = null;
      resolve({ running: false, error: String(err?.message || err) });
    };
    httpServer.once('error', onError);
    httpServer.listen(port, ip, () => {
      httpServer.removeListener('error', onError);
      // Permanent handler so a later runtime socket error logs instead of crashing.
      httpServer.on('error', (err) => console.warn('[mobile-server]', err?.message || err));
      boundAddress = { host: ip, port };
      serveInfo = pendingServeInfo;
      // Push status changes to connected phones (change-driven, 1s poll of the
      // status authority; only sends when the board-relevant signature moves).
      lastTerminalsSig = null;
      // Seed dedup state from the current snapshot so a (re)start does not blast
      // stale needs/exit pushes for sessions that were already in that state
      // before the server came up. Audit MED-6.
      seedPushBaseline();
      statusBroadcastTimer = setInterval(pollStatusTick, 1000);
      // Context (model + ctx%) is transcript-derived, so recompute on a slow
      // debounce, not every status tick. Runs once now, then every 20s.
      refreshTabContexts();
      contextRefreshTimer = setInterval(refreshTabContexts, 20000);
      startPowerAssertion(); // keep the Mac awake for remote work while up
      updateMobileServerConfig({ enabled: true });
      resolve(getMobileServerStatus());
    });
  });
}

/** Stop the server. Resolves to a status object. */
export function stopMobileServer() {
  // Close every authenticated client socket explicitly. wss.close() rejects
  // new connections but leaves existing ones alive until they drop on their
  // own — phones could keep streaming PTY data after stopMobileServer.
  // Codex v1.0.28 round-1 MED.
  for (const sockets of activeSocketsByToken.values()) {
    for (const s of sockets) {
      try { s.close(1001, 'server stopped'); } catch { /* noop */ }
    }
  }
  activeSocketsByToken.clear();
  if (statusBroadcastTimer) { clearInterval(statusBroadcastTimer); statusBroadcastTimer = null; }
  if (contextRefreshTimer) { clearInterval(contextRefreshTimer); contextRefreshTimer = null; }
  tabContextCache.clear();
  lastTerminalsSig = null;
  prevStatusById.clear();
  notifiedExits.clear();
  stopPowerAssertion();
  if (wss) { try { wss.close(); } catch { /* noop */ } wss = null; }
  // Capture the server so we can AWAIT its close before a caller restarts on the
  // same port. Sockets + wss are already closed above, so close() completes
  // promptly rather than waiting on live connections. Codex v1.0.43 Phase 4 P2.
  const server = httpServer;
  httpServer = null;
  boundAddress = null;
  serveInfo = null;
  pairingCode = null;
  pairAttempts = 0;
  pairLockedUntil = 0;
  updateMobileServerConfig({ enabled: false });
  return new Promise((resolve) => {
    if (!server) return resolve(getMobileServerStatus());
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer); // don't leave a live timer after close
      resolve(getMobileServerStatus());
    };
    try { server.close(finish); } catch { finish(); }
    // Safety net if close stalls; unref so it never keeps the process alive.
    timer = setTimeout(finish, 3000);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
}

/** Regenerate the pairing code (only meaningful while running). */
export function regeneratePairingCode() {
  if (!httpServer) return null;
  pairingCode = genPairingCode();
  pairAttempts = 0;
  pairLockedUntil = 0; // a manual regenerate should unblock pairing immediately
  return pairingCode;
}

/**
 * Remove a paired device by its opaque deviceId. Closes every authenticated
 * WebSocket associated with the revoked device's token so a pre-revocation
 * connection can't keep terminal access. Falls back to token-matching for
 * pre-v1.0.28 callers (legacy UI passed the raw token); new UI passes deviceId.
 * Codex v1.0.28 HIGHs (main.js:987 + mobile-server.js:400).
 */
export function removeMobileDevice(idOrToken) {
  const cfg = getMobileServerConfig();
  // Match by stored deviceId, the derived legacy deviceId, OR raw token
  // (last is a back-compat path; current UI passes deviceId only).
  const removed = cfg.devices.find((d) =>
    d.deviceId === idOrToken
    || deriveDeviceId(d) === idOrToken
    || d.token === idOrToken);
  if (!removed) return getMobileServerStatus();
  updateMobileServerConfig({ devices: cfg.devices.filter((d) => d !== removed) });
  // Force-close every authenticated socket bound to the revoked token.
  const sockets = activeSocketsByToken.get(removed.token);
  if (sockets) {
    for (const s of sockets) {
      try { s.close(4003, 'revoked'); } catch { /* noop */ }
    }
    activeSocketsByToken.delete(removed.token);
  }
  // Revoke push too, so the removed phone stops getting notifications. Codex P1.
  removePushSubscriptionsByToken(removed.token);
  return getMobileServerStatus();
}

/** Start on launch if the user previously enabled it. */
export async function maybeAutoStartMobileServer() {
  if (getMobileServerConfig().enabled) {
    return startMobileServer();
  }
  return getMobileServerStatus();
}
