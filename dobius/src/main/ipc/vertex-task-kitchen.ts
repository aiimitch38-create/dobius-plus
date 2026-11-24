/* Carson's "Send to kitchen" / "Remove" on a Kanban card.
 *
 * The mark starts an agent, so it has to be Carson's own act:
 *  - only the top frame of a first-party window may ask (no agent, CLI or
 *    webview guest has this channel);
 *  - sending a card needs Touch ID, shown by main. An agent can click the
 *    button through computer-use or a script, but only Carson's finger passes
 *    (same gate as sending a text, 7.17). No click fallback;
 *  - while the prompt is open, computer-use on Dobius+ itself is refused
 *    (protected-self-ui.ts, defense in depth);
 *  - what is marked is the stored card as it was when the prompt opened. If
 *    its text changed meanwhile, nothing is marked. */

import { ipcMain, type IpcMainInvokeEvent } from 'electron'

import type { VertexTask, VertexTaskKitchenMarkResult } from '../../shared/vertex-task-types'
import { withProtectedSelfUi } from '../computer/protected-self-ui'
import { requireTouchId, TOUCH_ID_REQUIRED } from '../imessage-bridge/touch-id-gate'
import { kitchenMarkPatch, pumpKitchenSoon } from '../vertex/kitchen'
import { vertexTaskStore } from '../vertex/vertex-task-store'

const TITLE_MAX = 60
const NOT_SENT = 'Not sent.'
const refusedWith = (error: string): VertexTaskKitchenMarkResult => ({ ok: false, error })
let confirmCounter = 0

/** The stored card with its own fields only (never an inherited mark). */
function storedCard(taskId: string): VertexTask | null {
  const task = vertexTaskStore.list().find((candidate) => candidate.id === taskId)
  return task ? { ...task } : null
}

function promptReason(task: VertexTask): string {
  // oxlint-disable-next-line no-control-regex -- removing control characters is the point
  const title = task.title.replace(/[\u0000-\u001F\u007F"]/g, ' ').replace(/\s+/g, ' ').trim()
  const shown = title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title
  // macOS shows this after "Dobius+ is trying to".
  return `send the card "${shown}" to the kitchen, which starts a restricted Claude agent on it`
}

export function registerVertexTaskKitchenHandler(
  isOperatorSender: (event: IpcMainInvokeEvent) => boolean
): void {
  ipcMain.removeHandler('vertexTasks:setKitchen')
  ipcMain.handle(
    'vertexTasks:setKitchen',
    async (event, args: { taskId: string; on: boolean }): Promise<VertexTaskKitchenMarkResult> => {
      if (!args || typeof args.taskId !== 'string' || !args.taskId.trim() || typeof args.on !== 'boolean') {
        return refusedWith(NOT_SENT)
      }
      if (!isOperatorSender(event)) {
        console.warn('[vertex-tasks] setKitchen refused: not a first-party app window')
        return refusedWith(NOT_SENT)
      }
      const task = storedCard(args.taskId)
      const patch = task ? kitchenMarkPatch(task, args.on, Date.now()) : null
      if (!task || !patch) {
        return refusedWith(args.on ? 'Not sent: this card cannot go to the kitchen now.' : 'Not removed.')
      }
      if (args.on) {
        confirmCounter += 1
        const refused = await withProtectedSelfUi(`kitchen-mark:${confirmCounter}`, () =>
          requireTouchId(promptReason(task))
        )
        if (refused) {
          return refusedWith(
            refused === TOUCH_ID_REQUIRED
              ? 'Not sent: the kitchen needs Touch ID on this Mac.'
              : 'Not sent: Touch ID was cancelled.'
          )
        }
        // Why re-read: the prompt was open for a while; only the card Carson
        // was asked about, still waiting and unmarked, is sent.
        const now = storedCard(args.taskId)
        if (
          !now ||
          now.title !== task.title ||
          now.description !== task.description ||
          !kitchenMarkPatch(now, true, 0)
        ) {
          return refusedWith('Not sent: the card changed while Touch ID was open.')
        }
      }
      const updated = vertexTaskStore.update(args.taskId, patch)
      if (updated && args.on) {
        pumpKitchenSoon()
      }
      return updated ? { ok: true, task: updated } : refusedWith(NOT_SENT)
    }
  )
}
