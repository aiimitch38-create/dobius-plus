// App services over RPC (CLI `dobius usage`, `limits`, `knowledge`,
// `imessage status`, `version`, `update status`, `backup`, `feedback`). Each
// method calls the same main-process function as the window's IPC handler.
// Backing up now and sending feedback (data leaves the Mac) wait for a human
// click in the app's dialog (confirm-gate.ts); the rest only read.
// Not here on purpose: installing or downloading updates, connecting AWS,
// exporting the recovery key, and the iMessage test send.
import { app } from 'electron'
import { z } from 'zod'
import { getImessageBridgeStatus } from '../../../imessage-bridge/bridge-service'
import { updateStatusForRuntime } from '../../../updater-status-access'
import { submitFeedback, type FeedbackSubmitResult } from '../../../ipc/feedback'
import { desktopCloudBackupController } from '../../../cloud-backup/desktop-controller'
import {
  knowledgeTreeForRuntime,
  readKnowledgeFileForRuntime
} from '../../../ipc/knowledge-access'
import { rateLimitsForRuntime, usageSummaryForRuntime } from '../../../ipc/usage-access'
import { defineMethod, type RpcMethod } from '../core'
import { requiredString } from '../schemas'
import {
  CONFIRM_TEXT_LIMIT,
  confirmText,
  describeCaller,
  hasHiddenCharacters,
  HIDDEN_CHARACTERS_MESSAGE,
  type ConfirmationGate
} from './confirm-gate'
import { appConfirmationGate } from './crew-confirm'

const UsageSummary = z
  .object({
    provider: z.enum(['claude', 'codex', 'opencode']).default('claude'),
    scope: z.enum(['dobius', 'all']).default('all'),
    range: z.enum(['7d', '30d', '90d', 'all']).default('7d')
  })
  .strict()

const RateLimits = z.object({ refresh: z.boolean().optional() }).strict()

const KnowledgeRead = z.object({ path: requiredString('Missing knowledge file path') }).strict()

const Feedback = z
  .object({
    // Why refuse hidden characters: the dialog would not show them, but they
    // would leave the Mac with the text.
    text: z
      .string()
      .refine((value) => !hasHiddenCharacters(value), HIDDEN_CHARACTERS_MESSAGE)
      .transform((value) => value.trim())
      .pipe(
        z
          .string()
          .min(1, 'Missing feedback text')
          .max(
            CONFIRM_TEXT_LIMIT,
            `Feedback is too long to confirm (over ${CONFIRM_TEXT_LIMIT} characters); use Report a problem in the app`
          )
      )
  })
  .strict()

export type AppServiceDeps = {
  submitFeedback: (text: string) => Promise<FeedbackSubmitResult>
}

const LIVE_DEPS: AppServiceDeps = {
  // Why anonymous: the command line has no signed-in identity to attach, and
  // the in-app form is where Carson chooses to share his GitHub name.
  submitFeedback: (text) =>
    submitFeedback({
      feedback: text,
      submitAnonymously: true,
      githubLogin: null,
      githubEmail: null,
      submissionType: 'feedback'
    })
}

export function buildAppServiceMethods(
  requireConfirmation: ConfirmationGate,
  deps: AppServiceDeps = LIVE_DEPS
): RpcMethod[] {
  return [
    defineMethod({
      name: 'usage.summary',
      params: UsageSummary,
      handler: (params) => usageSummaryForRuntime(params.provider, params.scope, params.range)
    }),
    defineMethod({
      name: 'usage.rateLimits',
      params: RateLimits,
      handler: (params) => rateLimitsForRuntime(params.refresh === true)
    }),
    defineMethod({
      name: 'knowledge.tree',
      params: null,
      handler: () => knowledgeTreeForRuntime()
    }),
    defineMethod({
      name: 'knowledge.read',
      params: KnowledgeRead,
      handler: (params) => readKnowledgeFileForRuntime(params.path)
    }),
    defineMethod({
      name: 'imessage.status',
      params: null,
      handler: (_params, ctx) => {
        const status = getImessageBridgeStatus()
        // Why: a background agent needs whether the bridge works, not Carson's
        // own phone number or Apple ID.
        return ctx.agentKey ? { ...status, selfHandle: status.selfHandle ? 'set' : null } : status
      }
    }),
    defineMethod({
      name: 'app.version',
      params: null,
      handler: () => ({ version: app.getVersion() })
    }),
    defineMethod({
      name: 'app.updateStatus',
      params: null,
      handler: () => ({ version: app.getVersion(), update: updateStatusForRuntime() })
    }),
    defineMethod({
      name: 'backup.status',
      params: null,
      handler: () => desktopCloudBackupController().getStatus()
    }),
    defineMethod({
      name: 'backup.run',
      params: null,
      handler: async (_params, ctx) => {
        const controller = desktopCloudBackupController()
        const before = controller.getStatus()
        // Why before the dialog: say plainly what is wrong instead of asking
        // Carson to confirm a backup that cannot start.
        if (!before.supported || !before.configured) {
          throw new Error(before.detail || 'Connect AWS backups in Settings first.')
        }
        if (before.health === 'running' || before.health === 'connecting') {
          throw new Error('A backup is already running. Wait for it to finish.')
        }
        await requireConfirmation(
          {
            title: 'Back up to AWS now?',
            message: 'Something outside the app asked to start a cloud backup now.',
            detail: `${describeCaller(ctx)}\n\nYour projects and app data are copied, encrypted, to bucket ${confirmText(before.bucket, 'bucket')} (${confirmText(before.region, 'region')}).`,
            confirmLabel: 'Back up now'
          },
          ctx
        )
        // Why re-read: the dialog named a bucket and region; if backups were
        // reconnected elsewhere while it was open, that approval no longer fits.
        // start() itself refuses if a backup began meanwhile.
        const after = controller.getStatus()
        if (
          !after.configured ||
          after.bucket !== before.bucket ||
          after.region !== before.region ||
          after.repository !== before.repository
        ) {
          throw new Error(
            'The backup settings changed while the dialog was open, so nothing was started. Run it again.'
          )
        }
        return controller.start('run')
      }
    }),
    defineMethod({
      name: 'feedback.submit',
      params: Feedback,
      handler: async (params, ctx) => {
        await requireConfirmation(
          {
            title: 'Send this feedback to the Dobius+ team?',
            message: 'Something outside the app asked to send feedback. It leaves this Mac.',
            detail: `${describeCaller(ctx)}\n\nSent without your name, with the app version and OS:\n\n${confirmText(params.text, 'feedback')}`,
            confirmLabel: 'Send feedback'
          },
          ctx
        )
        const result = await deps.submitFeedback(params.text)
        if (!result.ok) {
          throw new Error(
            `Feedback could not be sent (${result.error}). Try again later or use Report a problem in the app.`
          )
        }
        return { sent: true as const }
      }
    })
  ]
}

export const APP_SERVICE_METHODS: RpcMethod[] = buildAppServiceMethods(appConfirmationGate)
