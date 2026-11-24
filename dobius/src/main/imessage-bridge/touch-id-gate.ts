// Touch ID as the one human gate for texts (7.17): computer-use and osascript
// can click, but only Carson's finger passes this. No click fallback.
import { systemPreferences } from 'electron'

export const TOUCH_ID_REQUIRED = 'Sending needs Touch ID on this Mac'

export type TouchId = Pick<typeof systemPreferences, 'canPromptTouchID' | 'promptTouchID'>

/** Null once Carson confirms with Touch ID; otherwise why not. */
export async function requireTouchId(
  reason: string,
  touchId: TouchId = systemPreferences,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  if (platform !== 'darwin' || typeof touchId?.canPromptTouchID !== 'function' || !touchId.canPromptTouchID()) {
    return TOUCH_ID_REQUIRED
  }
  try {
    await touchId.promptTouchID(reason)
    return null
  } catch {
    // Why a fixed reason: the prompt rejects for cancel, lockout or failure alike, and all mean "no".
    return 'Touch ID was not confirmed.'
  }
}
