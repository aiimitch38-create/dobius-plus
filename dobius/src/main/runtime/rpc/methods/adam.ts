// ADAM over RPC (CLI `dobius adam ask|say|status|mode`). Every ask goes through
// the one `askAdam` entry point in jarvis-ipc.ts, so the command line talks to
// the same Hermes session and the same thread as voice and the Board, and main
// writes the thread rows. Why gated: interactive terminals hold the full
// runtime key, so an agent could put words in ADAM's thread (and ADAM can run
// commands), make ADAM speak, or flip voice mode. A human click in the app's
// dialog is the only proof of Carson, so all three wait for it.
import { z } from 'zod'
import type { JarvisAskResult, JarvisSpeakOutcome } from '../../../../shared/speech-types'
import {
  ADAM_BUSY_TEXT,
  ADAM_CLI_MAX_TEXT_CHARS,
  ADAM_CLI_SOURCE_PATTERN,
  cliMessage,
  cliSaid,
  type AdamAskOptions
} from '../../../jarvis/adam-conversation'
import {
  adamRuntimeAccess,
  type JarvisVoiceControls
} from '../../../jarvis/adam-runtime-access'
import { defineMethod, type RpcMethod } from '../core'
import {
  CONFIRM_TEXT_LIMIT,
  confirmText,
  describeCaller,
  hasHiddenCharacters,
  HIDDEN_CHARACTERS_MESSAGE,
  type ConfirmationGate
} from './confirm-gate'
import { appConfirmationGate } from './crew-confirm'

/** Said before CLI text, so nobody mistakes it for ADAM's own words. */
export const ADAM_SAY_PREFIX = 'A command-line tool asked me to say: '
// The dialog must show the whole spoken line, prefix included.
const MAX_SAY_CHARS = CONFIRM_TEXT_LIMIT - ADAM_SAY_PREFIX.length

// Why: the dialog strips hidden characters before showing text, but ADAM
// would get them, so instructions could hide in them (confirm-gate.ts).
const HIDDEN_MESSAGE = HIDDEN_CHARACTERS_MESSAGE

const Ask = z
  .object({
    text: z
      .string()
      .refine((value) => !hasHiddenCharacters(value), HIDDEN_MESSAGE)
      .transform((value) => value.trim())
      .pipe(
        z
          .string()
          .min(1, 'Missing message text')
          .max(
            ADAM_CLI_MAX_TEXT_CHARS,
            `Message is too long (over ${ADAM_CLI_MAX_TEXT_CHARS} characters); send it in shorter parts`
          )
      ),
    source: z
      .string()
      .refine((value) => !hasHiddenCharacters(value), HIDDEN_MESSAGE)
      .transform((value) => value.trim())
      .pipe(
        z.string().regex(
        ADAM_CLI_SOURCE_PATTERN,
          'Source must be a short name: letters, numbers, spaces, dot, dash or underscore (up to 40)'
        )
      )
      .optional(),
    wait: z.boolean().optional()
  })
  .strict()

const Say = z
  .object({
    text: z
      .string()
      .refine((value) => !hasHiddenCharacters(value), HIDDEN_MESSAGE)
      .transform((value) => value.trim())
      .pipe(
        z
          .string()
          .min(1, 'Missing text to say')
          .max(MAX_SAY_CHARS, `Text is too long to say (over ${MAX_SAY_CHARS} characters)`)
      )
  })
  .strict()

const SetMode = z.object({ active: z.boolean() }).strict()

export type AdamMethodDeps = {
  isBusy: () => boolean
  ask: (text: string, options: AdamAskOptions) => Promise<JarvisAskResult>
  voice: () => JarvisVoiceControls | null
}

const NOT_READY = 'ADAM is not ready yet. Open the Dobius+ window and try again.'

const LIVE_DEPS: AdamMethodDeps = {
  isBusy: () => adamRuntimeAccess()?.isBusy() ?? false,
  ask: (text, options) => {
    const access = adamRuntimeAccess()
    if (!access) {
      return Promise.resolve({ kind: 'error', text: NOT_READY })
    }
    return access.ask(text, options)
  },
  voice: () => adamRuntimeAccess()?.voice ?? null
}

function requireVoice(deps: AdamMethodDeps): JarvisVoiceControls {
  const voice = deps.voice()
  if (!voice) {
    throw new Error('ADAM voice is not ready yet. Open the Dobius+ window and try again.')
  }
  return voice
}

export function buildAdamMethods(
  requireConfirmation: ConfirmationGate,
  deps: AdamMethodDeps = LIVE_DEPS
): RpcMethod[] {
  return [
    defineMethod({
      name: 'adam.ask',
      params: Ask,
      handler: async (params, ctx) => {
        const source = params.source ?? null
        // Why before the dialog: a busy ADAM would refuse the turn anyway, and
        // ADAM calling this from inside his own turn must not raise a dialog.
        if (deps.isBusy()) {
          throw new Error(ADAM_BUSY_TEXT)
        }
        await requireConfirmation(
          {
            title: 'Send this message to ADAM?',
            message: 'Something outside the app asked to send ADAM a message in his thread.',
            detail: [
              describeCaller(ctx),
              `Sent by: ${source ? confirmText(source, 'source') : 'not named'}`,
              '',
              confirmText(params.text, 'message')
            ].join('\n'),
            confirmLabel: 'Send to ADAM'
          },
          ctx
        )
        // Why re-check: a turn may have started while the dialog was open. No
        // await between this check and ask(), which marks ADAM busy at once.
        if (deps.isBusy()) {
          throw new Error(ADAM_BUSY_TEXT)
        }
        const reply = deps.ask(cliMessage(params.text, source), {
          source: 'cli',
          said: cliSaid(params.text, source)
        })
        if (!params.wait) {
          // The reply lands in ADAM's thread; nobody here waits for it.
          reply.catch((error: unknown) => console.warn('ADAM command-line turn failed:', error))
          return { sent: true as const, waited: false as const }
        }
        return { sent: true as const, waited: true as const, reply: await reply }
      }
    }),
    defineMethod({
      name: 'adam.status',
      params: null,
      handler: () => {
        const voice = deps.voice()
        return {
          busy: deps.isBusy(),
          voiceReady: voice !== null,
          ...(voice ? voice.status() : {})
        }
      }
    }),
    defineMethod({
      name: 'adam.say',
      params: Say,
      handler: async (params, ctx): Promise<JarvisSpeakOutcome> => {
        requireVoice(deps)
        const spoken = `${ADAM_SAY_PREFIX}${params.text}`
        await requireConfirmation(
          {
            title: 'Let ADAM say this out loud?',
            message: 'Something outside the app asked ADAM to say something out loud.',
            detail: `${describeCaller(ctx)}\n\nADAM will say:\n${confirmText(spoken, 'text')}`,
            confirmLabel: 'Say it'
          },
          ctx
        )
        return requireVoice(deps).speak(spoken)
      }
    }),
    defineMethod({
      name: 'adam.setMode',
      params: SetMode,
      handler: async (params, ctx) => {
        requireVoice(deps)
        await requireConfirmation(
          {
            title: params.active ? 'Turn ADAM voice mode on?' : 'Turn ADAM voice mode off?',
            message: `Something outside the app asked to turn ADAM voice mode ${params.active ? 'on' : 'off'}.`,
            detail: `${describeCaller(ctx)}\n\n${
              params.active
                ? 'ADAM will listen for the Cmd+T shortcut.'
                : 'ADAM stops listening for Cmd+T and stops any answer he is speaking.'
            }`,
            confirmLabel: params.active ? 'Turn on' : 'Turn off'
          },
          ctx
        )
        const result = requireVoice(deps).setMode(params.active)
        return { active: params.active, ok: result.ok }
      }
    })
  ]
}

export const ADAM_METHODS: RpcMethod[] = buildAdamMethods(appConfirmationGate)
