// What an identified agent (explicit `--as` / DOBIUS_AGENT_ID, or the synthesized
// tile identity) may do through the browser surface, keyed by RPC method name.
// The bridge is the single enforcement point (every enqueued page command names
// its method); the RPC layer refuses early for explicit identities. Every browser
// method must appear here; the policy test enumerates the RPC method lists and
// fails on any method that is missing, so a new command cannot bypass the gates.
import { BrowserError } from './cdp-bridge'

/**
 * - staged: routed through the cursor driver (clearance, claim, move/hover/dwell,
 *   gate, re-check) via withAgentAction.
 * - read: no page mutation; allowed without staging.
 * - deny: refused with `agent_action_forbidden`.
 */
export type AgentBrowserMethodPolicy = 'staged' | 'read' | 'deny'

export const AGENT_BROWSER_METHOD_POLICY: Readonly<Record<string, AgentBrowserMethodPolicy>> = {
  // core
  'browser.snapshot': 'read',
  'browser.click': 'staged',
  'browser.goto': 'staged',
  'browser.fill': 'staged',
  'browser.type': 'staged',
  'browser.keyboardInsertText': 'staged',
  'browser.select': 'staged',
  'browser.scroll': 'staged',
  'browser.back': 'staged',
  'browser.reload': 'staged',
  'browser.screenshot': 'read',
  'browser.eval': 'deny',
  'browser.tabList': 'read',
  'browser.tabShow': 'read',
  'browser.tabCurrent': 'read',
  'browser.tabSwitch': 'deny',
  'browser.tabCreate': 'deny',
  'browser.tabSetProfile': 'deny',
  'browser.tabProfileShow': 'read',
  'browser.tabProfileClone': 'deny',
  'browser.tabClose': 'deny',
  'browser.profileList': 'read',
  'browser.profileCreate': 'deny',
  'browser.profileDelete': 'deny',
  'browser.profileDetectBrowsers': 'deny',
  'browser.profileImportFromBrowser': 'deny',
  'browser.profileClearDefaultCookies': 'deny',
  'browser.hover': 'staged',
  'browser.drag': 'staged',
  'browser.upload': 'deny',
  'browser.wait': 'read',
  'browser.check': 'staged',
  'browser.focus': 'staged',
  'browser.clear': 'staged',
  'browser.selectAll': 'staged',
  'browser.keypress': 'staged',
  'browser.pdf': 'read',
  'browser.fullScreenshot': 'read',
  'browser.dblclick': 'staged',
  'browser.forward': 'staged',
  'browser.scrollIntoView': 'staged',
  'browser.get': 'read',
  'browser.is': 'read',
  'browser.find': 'deny',
  'browser.console': 'read',
  'browser.network': 'read',
  'browser.exec': 'deny',
  'browser.capture.start': 'deny',
  'browser.capture.stop': 'deny',
  'browser.download': 'deny',
  'browser.highlight': 'staged',
  // screencast
  'browser.screencast': 'deny',
  'browser.screencast.unsubscribe': 'read',
  // extras
  'browser.cookie.get': 'read',
  'browser.cookie.set': 'deny',
  'browser.cookie.delete': 'deny',
  'browser.viewport': 'deny',
  'browser.geolocation': 'deny',
  'browser.intercept.enable': 'deny',
  'browser.intercept.disable': 'deny',
  'browser.intercept.list': 'read',
  'browser.mouseMove': 'staged',
  'browser.mouseDown': 'deny',
  'browser.mouseClick': 'staged',
  'browser.mouseUp': 'deny',
  'browser.mouseWheel': 'staged',
  'browser.setDevice': 'deny',
  'browser.setOffline': 'deny',
  'browser.setHeaders': 'deny',
  'browser.setCredentials': 'deny',
  'browser.setMedia': 'deny',
  'browser.clipboardRead': 'read',
  'browser.clipboardWrite': 'deny',
  'browser.dialogAccept': 'staged',
  'browser.dialogDismiss': 'staged',
  'browser.storage.local.get': 'read',
  'browser.storage.local.set': 'deny',
  'browser.storage.local.clear': 'deny',
  'browser.storage.session.get': 'read',
  'browser.storage.session.set': 'deny',
  'browser.storage.session.clear': 'deny'
}

const DENY_HINT =
  'Agents act in tiles only through snapshot/get/is to read and click/type/fill/scroll/keypress to act.'

export function assertAgentMayUseMethod(agentName: string, methodName: string): void {
  const policy = AGENT_BROWSER_METHOD_POLICY[methodName]
  // Why: an unlisted method fails closed; the policy test keeps the list complete.
  if (policy === undefined || policy === 'deny') {
    throw new BrowserError(
      'agent_action_forbidden',
      `${agentName} may not call ${methodName} inside a web tile. ${DENY_HINT}`
    )
  }
}
