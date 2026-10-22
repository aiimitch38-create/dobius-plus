import type {
  ComputerListWindowsResult,
  ComputerSnapshotResult
} from '../../shared/computer-use-runtime-types'

/**
 * One decision point every agent computer-use action passes through. Today it runs fixed rules;
 * the Laya classifier plugs in here later (shadow first, then advisory) without changing callers.
 */
export type ComputerActionDecision =
  | { verdict: 'allow'; rule: null; reason: null; source: 'rules' }
  | { verdict: 'block'; rule: 'pick-window' | 'confirm-risky'; reason: string; source: 'rules' }

type DecisionDeps = {
  listWindows: (params: { app: unknown }) => Promise<ComputerListWindowsResult>
}

// Kept narrow on purpose: a warning on every click would teach agents to ignore it.
const RISKY_LABEL =
  /\b(delete|remove|trash|discard|erase|send|pay|purchase|buy|place order|checkout|transfer|withdraw|sign out|log ?out|unsubscribe|publish|uninstall|reset)\b/i
const MAX_REMEMBERED_APPS = 32
const latestTrees = new Map<string, string>()

/** Remembers the latest accessibility tree per app so element indexes can be resolved to labels. */
export function rememberComputerSnapshot(app: unknown, result: ComputerSnapshotResult): void {
  const treeText = result?.snapshot?.treeText
  if (typeof app !== 'string' || typeof treeText !== 'string') {
    return
  }
  latestTrees.delete(app)
  latestTrees.set(app, treeText)
  if (latestTrees.size > MAX_REMEMBERED_APPS) {
    latestTrees.delete(latestTrees.keys().next().value as string)
  }
}

export function resetComputerDecisionStateForTest(): void {
  latestTrees.clear()
}

/** The risky word an element's label matches, if any, from the app's latest tree. */
export function riskyElementWord(app: unknown, elementIndex: unknown): string | null {
  if (typeof app !== 'string' || typeof elementIndex !== 'number') {
    return null
  }
  const line = latestTrees
    .get(app)
    ?.split('\n')
    .find((entry) => entry.trim().startsWith(`${elementIndex} `))
  return line?.match(RISKY_LABEL)?.[1]?.toLowerCase() ?? null
}

export function actionTargetKind(method: string, params: Record<string, unknown>): string {
  if (params.elementIndex !== undefined || params.fromElementIndex !== undefined) {
    return 'element'
  }
  if (params.x !== undefined || params.fromX !== undefined) {
    return 'coordinates'
  }
  return ['typeText', 'pressKey', 'hotkey', 'pasteText'].includes(method) ? 'keyboard' : 'none'
}

export async function decideComputerAction(
  method: string,
  params: Record<string, unknown>,
  deps: DecisionDeps
): Promise<ComputerActionDecision> {
  const pinned = params.windowId !== undefined || params.windowIndex !== undefined
  if (actionTargetKind(method, params) === 'coordinates' && !pinned) {
    // An unavailable window list is "unknown", not "several": fall back to pre-guard behavior.
    let listed: ComputerListWindowsResult | null = null
    try {
      listed = await deps.listWindows({ app: params.app })
    } catch (error) {
      listed = null
      void error
    }
    const windows = Array.isArray(listed?.windows) ? listed.windows : []
    const open = windows.filter((window) => !window.isMinimized).length
    // Coordinates are window-relative; with several windows open (Chrome profiles, Stage
    // Manager) an unpinned click can land in a different window than the screenshot showed.
    if (open > 1) {
      return {
        verdict: 'block',
        rule: 'pick-window',
        reason: `${open} windows are open for this app, so a coordinate ${method} could hit the wrong one. Pass --window-id from list-windows (the window your screenshot came from), or target an --element-index instead.`,
        source: 'rules'
      }
    }
  }
  if (method === 'click' || method === 'performSecondaryAction') {
    const word = riskyElementWord(params.app, params.elementIndex)
    if (word && params.confirmRisky !== true) {
      return {
        verdict: 'block',
        rule: 'confirm-risky',
        reason: `Element ${String(params.elementIndex)} looks like a "${word}" control. Only proceed if the user explicitly asked for this; then re-run with --confirm-risky.`,
        source: 'rules'
      }
    }
  }
  return { verdict: 'allow', rule: null, reason: null, source: 'rules' }
}
