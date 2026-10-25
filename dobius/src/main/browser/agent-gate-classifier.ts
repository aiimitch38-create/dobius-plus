// Classifies a browser action as needing human approval before an agent may
// dispatch it (docs/board/research/AGENT-CURSORS-RESEARCH.md §6.4 gates).
// Inputs are page content and therefore untrusted: this is pattern matching
// only, it never executes anything the page says. Risky actions FAIL CLOSED:
// when the target cannot be verified they gate as 'unverified'.
import type { AgentGateKind } from '../../shared/agent-cursor'

export type { AgentGateKind }

export type AgentActionKind =
  | 'click'
  | 'dblclick'
  | 'rightclick'
  | 'type'
  | 'key'
  | 'scroll'
  | 'drag'
  | 'hover'
  | 'move'
  | 'navigate'

/** What the isolated-world descriptor eval reports about the element under the pointer. */
export type AgentTargetDescriptor = {
  tag?: string | null
  type?: string | null
  name?: string | null
  id?: string | null
  role?: string | null
  autocomplete?: string | null
  placeholder?: string | null
  ariaLabel?: string | null
  href?: string | null
  download?: boolean
  text?: string | null
  value?: string | null
  inputMode?: string | null
  editable?: boolean
  /** Hit landed on a custom element whose shadow tree cannot be inspected (closed root). */
  closedShadow?: boolean
  form?: { hasPassword?: boolean; hasOtp?: boolean } | null
  /** Trusted page URL (from main's `webContents.getURL()`), never the page's own report. */
  url?: string | null
}

/** Extra facts about the action itself (not from the page). */
export type AgentActionIntent = {
  /** Key name for `key` actions, e.g. "Enter", "Meta+Enter". */
  key?: string
  /** `type`/`fill` text ends with a newline (submits chat boxes). */
  textEndsWithNewline?: boolean
}

const OTP_PATTERN = /\b(otp|one[- ]?time|verification code|security code|2fa|mfa|passcode|auth(entication)? code)\b/i
const LOGIN_SUBMIT_PATTERN = /\b(sign ?in|log ?in|log ?on|continue with|authenticate|verify)\b/i
const PURCHASE_PATTERN =
  /\b(buy( now)?|purchase|check ?out|place (your |the )?order|pay( now)?|complete (order|purchase|payment)|confirm (order|payment|purchase)|subscribe|add payment|start (free )?trial|upgrade plan)\b/i
const PURCHASE_URL_PATTERN = /\/(checkout|payment|pay|billing|cart\/confirm)(\/|\?|$)/i
const AUTH_HOST_PATTERN =
  /(^|\.)(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|appleid\.apple\.com|auth0\.com|okta\.com|login\.yahoo\.com|id\.atlassian\.com|github\.com)$|^(login|signin|sign-in|sso|auth|accounts|id|idp)\./i
const AUTH_PATH_PATTERN = /\/(login|log-in|signin|sign-in|sign_in|oauth2?|authorize|sso|session\/new)(\/|\?|$)/i
const PUBLISH_PATTERN = /\b(publish|go live|release|deploy|make public|post publicly)\b/i
const SEND_PATTERN =
  /\b(send( (message|email|mail|reply|invite|request))?|post( (comment|reply|message))?|reply|tweet|submit( (message|comment|review|form))?|share)\b/i
const DELETE_PATTERN =
  /\b(delete|remove|destroy|erase|trash|discard|uninstall|revoke|permanently|wipe|clear all)\b/i
const DOWNLOAD_PATTERN = /\b(download|export|save as|get the app|install)\b/i
const DOWNLOAD_HREF_PATTERN = /\.(pdf|zip|dmg|exe|msi|pkg|csv|xlsx?|docx?|tar|gz|tgz|7z|apk|iso)(\?|#|$)/i
const SUBMIT_KEY_PATTERN = /^((meta|cmd|command|control|ctrl)\+)?(enter|return)$/i

const SUBMIT_LIKE_TAGS = new Set(['button', 'a', 'summary'])
/** Pointer hits on these land in another document we cannot inspect: never trust them. */
export const EMBEDDED_TAGS: ReadonlySet<string> = new Set(['iframe', 'frame', 'object', 'embed', 'portal', 'fencedframe'])
/** Actions that must never dispatch against an unverified target. */
export const VERIFIED_ACTIONS: ReadonlySet<AgentActionKind> = new Set([
  'click',
  'dblclick',
  'rightclick',
  'type',
  'key',
  'drag'
])

function labelOf(desc: AgentTargetDescriptor): string {
  return [desc.text, desc.value, desc.ariaLabel, desc.placeholder, desc.name, desc.id]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
    .slice(0, 400)
}

function isSubmitLike(desc: AgentTargetDescriptor): boolean {
  const tag = (desc.tag ?? '').toLowerCase()
  const type = (desc.type ?? '').toLowerCase()
  const role = (desc.role ?? '').toLowerCase()
  if (SUBMIT_LIKE_TAGS.has(tag)) {
    return true
  }
  if (tag === 'input' && (type === 'submit' || type === 'button' || type === 'image')) {
    return true
  }
  return role === 'button' || role === 'link' || role === 'menuitem'
}

function isComposer(desc: AgentTargetDescriptor): boolean {
  return (desc.tag ?? '').toLowerCase() === 'textarea' || desc.editable === true
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}

export function isAuthUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false
  }
  return AUTH_HOST_PATTERN.test(hostOf(url)) || AUTH_PATH_PATTERN.test(pathOf(url))
}

export function isPurchaseUrl(url: string | null | undefined): boolean {
  return !!url && PURCHASE_URL_PATTERN.test(pathOf(url))
}

export function isSecretField(desc: AgentTargetDescriptor | null | undefined): boolean {
  if (!desc) {
    return false
  }
  const type = (desc.type ?? '').toLowerCase()
  if (type === 'password') {
    return true
  }
  if ((desc.autocomplete ?? '').toLowerCase() === 'one-time-code') {
    return true
  }
  if ((desc.autocomplete ?? '').toLowerCase().includes('password')) {
    return true
  }
  // Why: attribute names are snake/kebab-cased ("otp_code"), which \b cannot split.
  const words = [desc.name, desc.id, desc.placeholder, desc.ariaLabel]
    .join(' ')
    .replace(/[_-]+/g, ' ')
  return OTP_PATTERN.test(words)
}

/**
 * Returns the gate kind an action needs, or null when it may proceed freely.
 * Precedence: unverified > login > purchase > delete > publish > send > download.
 * Scroll, hover, move and navigate never gate. Risky actions gate as
 * 'unverified' when there is no descriptor or the pointer lands in an embedded
 * document. Typing gates into secret fields (login) and on a newline inside a
 * composer (send); Enter in a composer is also send.
 */
export function classifyAgentGate(
  action: AgentActionKind,
  desc: AgentTargetDescriptor | null | undefined,
  intent: AgentActionIntent = {}
): AgentGateKind | null {
  if (action === 'scroll' || action === 'hover' || action === 'move' || action === 'navigate') {
    return null
  }
  if (!desc) {
    return VERIFIED_ACTIONS.has(action) ? 'unverified' : null
  }
  if (EMBEDDED_TAGS.has((desc.tag ?? '').toLowerCase())) {
    return 'unverified'
  }
  if (desc.closedShadow && VERIFIED_ACTIONS.has(action)) {
    return 'unverified'
  }
  const url = desc.url ?? ''

  if (action === 'type') {
    if (isSecretField(desc)) {
      return 'login'
    }
    if (!intent.textEndsWithNewline) {
      return null
    }
    // Why: a trailing newline submits the form just like Enter or its button.
    if (desc.form?.hasPassword || desc.form?.hasOtp || isAuthUrl(url)) {
      return 'login'
    }
    if (isPurchaseUrl(url)) {
      return 'purchase'
    }
    return isComposer(desc) ? 'send' : null
  }
  if (action === 'key') {
    // Why: Enter inside a credential form submits it just like the button would.
    if (desc.form?.hasPassword || desc.form?.hasOtp || isSecretField(desc)) {
      return 'login'
    }
    if (intent.key && SUBMIT_KEY_PATTERN.test(intent.key)) {
      if (isAuthUrl(url)) {
        return 'login'
      }
      if (isPurchaseUrl(url)) {
        return 'purchase'
      }
      if (isComposer(desc)) {
        return 'send'
      }
    }
    return null
  }

  const label = labelOf(desc)
  const submit = isSubmitLike(desc)

  if (isSecretField(desc)) {
    return 'login'
  }
  if (submit && (LOGIN_SUBMIT_PATTERN.test(label) || desc.form?.hasPassword || desc.form?.hasOtp)) {
    return 'login'
  }
  // Why: on auth and checkout pages the label is irrelevant; the page itself is the risk.
  if (isAuthUrl(url)) {
    return 'login'
  }
  if (isPurchaseUrl(url)) {
    return 'purchase'
  }
  if (submit && PURCHASE_PATTERN.test(label)) {
    return 'purchase'
  }
  if (submit && DELETE_PATTERN.test(label)) {
    return 'delete'
  }
  if (submit && PUBLISH_PATTERN.test(label)) {
    return 'publish'
  }
  if (submit && SEND_PATTERN.test(label)) {
    return 'send'
  }
  if (desc.download || DOWNLOAD_HREF_PATTERN.test(desc.href ?? '')) {
    return 'download'
  }
  if (submit && DOWNLOAD_PATTERN.test(label)) {
    return 'download'
  }
  return null
}

/**
 * Approval prompt text. Facts read by main (action, tag/type, hostname) come
 * first; anything the page supplied is quoted behind "page says:" so the user
 * never mistakes page text for Dobius's own description.
 */
export function agentGateLabel(
  action: AgentActionKind,
  desc: AgentTargetDescriptor | null | undefined,
  trustedUrl: string | null | undefined,
  fallback?: string
): string {
  const host = hostOf(trustedUrl ?? '') || 'unknown host'
  const tag = desc?.tag ? `<${desc.tag}${desc.type ? ` type=${desc.type}` : ''}>` : '<unverified target>'
  const pageText = (desc?.text || desc?.value || desc?.ariaLabel || desc?.placeholder || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  const head = fallback ? `${fallback} ${tag} on ${host}` : `${action} ${tag} on ${host}`
  return pageText ? `${head} (page says: "${pageText}")` : head
}

/**
 * JS evaluated inside an isolated world of the guest's main frame to describe
 * the control under a viewport point (or the active element when no point is
 * given). The page cannot patch DOM prototypes seen by an isolated world, but
 * the content is still the page's own: callers only pattern-match on it.
 */
export function agentTargetDescriptorExpression(point?: { x: number; y: number }): string {
  const x = point ? Number(point.x) : 0
  const y = point ? Number(point.y) : 0
  // Why: elementFromPoint / activeElement stop at a shadow host; the real
  // control lives inside the shadow tree, so descend through open roots. A
  // closed root cannot be inspected and is reported for a fail-closed gate.
  const descend = point
    ? `while (el && el.shadowRoot) { const inner = el.shadowRoot.elementFromPoint(${x}, ${y}); if (!inner || inner === el) break; el = inner; }`
    : `while (el && el.shadowRoot && el.shadowRoot.activeElement && el.shadowRoot.activeElement !== el) { el = el.shadowRoot.activeElement; }`
  const pick = point ? `document.elementFromPoint(${x}, ${y})` : 'document.activeElement'
  return `(() => {
    let el = ${pick};
    ${descend}
    if (!el || el === document.body || el === document.documentElement) return null;
    const closedShadow = el.tagName.includes('-') && !el.shadowRoot;
    const ctl = el.closest('button, a, input, select, textarea, summary, iframe, frame, object, embed, [role=button], [role=link], [role=menuitem], [contenteditable]') || el;
    const attr = (n) => ctl.getAttribute(n);
    const form = ctl.closest('form');
    const rect = ctl.getBoundingClientRect();
    const text = String(ctl.innerText || ctl.textContent || '').trim().slice(0, 200);
    return {
      tag: ctl.tagName.toLowerCase(),
      type: attr('type'), name: attr('name'), id: ctl.id || null, role: attr('role'),
      autocomplete: attr('autocomplete'), placeholder: attr('placeholder'),
      ariaLabel: attr('aria-label'), href: attr('href'), download: ctl.hasAttribute('download'),
      inputMode: attr('inputmode'), editable: !!ctl.isContentEditable, closedShadow,
      value: ctl.tagName === 'INPUT' && /^(submit|button|image)$/i.test(ctl.type || '') ? String(ctl.value || '').slice(0, 200) : null,
      text,
      form: form ? {
        hasPassword: !!form.querySelector('input[type=password]'),
        hasOtp: !!form.querySelector('input[autocomplete=one-time-code]')
      } : null,
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
    };
  })()`
}

export type AgentBox = { x: number; y: number; w: number; h: number }

/**
 * True when the element under the pointer plausibly IS the ref'd element: one
 * box contains the other (a ref may be a span inside the button it activates)
 * and, when both texts are known, one contains the other. Anything else looks
 * like an overlay or clickjack and must be gated.
 */
export function pointHitMatchesRef(
  refBox: AgentBox,
  refText: string | null,
  hit: { rect?: AgentBox; text?: string | null } | null
): boolean {
  if (!hit?.rect) {
    return false
  }
  const tolerance = 2
  const contains = (outer: AgentBox, inner: AgentBox): boolean =>
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.w <= outer.x + outer.w + tolerance &&
    inner.y + inner.h <= outer.y + outer.h + tolerance
  if (!contains(refBox, hit.rect) && !contains(hit.rect, refBox)) {
    return false
  }
  const norm = (value: string | null | undefined): string =>
    (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120)
  const a = norm(refText)
  const b = norm(hit.text)
  if (!a || !b) {
    return true
  }
  return a.includes(b) || b.includes(a)
}
