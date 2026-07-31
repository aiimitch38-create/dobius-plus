// Resolve the Claude session running in a terminal tab and estimate its context
// usage. Extracted from the data:estimateContextForTab IPC handler (v1.0.40) so
// BOTH that handler and the mobile board (v1.0.43 Phase 3b) share one
// implementation with the same stale-link safeguards. Main-process only.

import { getTerminalClaudeInfo, getTerminalCwd } from './terminal-manager.js';
import { getSessionTabMap } from './config-manager.js';
import { estimateContextForSession } from './data-service.js';

/**
 * @returns {Promise<{tokens:number, maxTokens:number, model:string} | null>}
 * null when no claude is running in the tab, or its transcript is unresolved.
 */
export async function estimateContextForTabId(tabId) {
  try {
    if (!tabId || typeof tabId !== 'string') return null;
    const info = await getTerminalClaudeInfo(tabId);
    if (!info) return null; // no claude running here
    const cwd = await getTerminalCwd(tabId);
    const map = getSessionTabMap() || {};

    // A `--resume` tab names its session in argv (read live). A fresh `claude`
    // has no argv id; fall back to the newest ACTIVELY-RUNNING map link.
    let sessionId = info.sessionId;
    let sessionProject = null;
    if (sessionId) {
      // The transcript lives under the SESSION's project, not necessarily the
      // tab's live cwd (a same-project resume from a subdir keeps it under the
      // original project). Prefer the mapped project, fall back to cwd.
      sessionProject = map[sessionId]?.projectPath || null;
    } else {
      // Only trust a link whose session is currently running, and only if it
      // was stamped at/after this process started (a link stamped earlier
      // belongs to a prior claude in the same recycled tab id). Mirrors the
      // v1.0.40 guards exactly.
      const RECENT_MS = 90 * 1000;
      const now = Date.now();
      let best = null;
      for (const [sid, entry] of Object.entries(map)) {
        if (entry?.tabId !== tabId) continue;
        const ran = entry.lastRunningAt || 0;
        if (ran <= 0 || (now - ran) > RECENT_MS) continue;
        if (info.startedAt && ran < info.startedAt) continue;
        if (!best || ran > best.ran) best = { sid, ran, projectPath: entry.projectPath };
      }
      sessionId = best?.sid || null;
      sessionProject = best?.projectPath || null;
    }
    if (!sessionId) return null;

    let result = sessionProject
      ? await estimateContextForSession(sessionId, sessionProject)
      : null;
    if (!result && cwd && cwd !== sessionProject) {
      result = await estimateContextForSession(sessionId, cwd);
    }
    return result;
  } catch {
    return null;
  }
}
