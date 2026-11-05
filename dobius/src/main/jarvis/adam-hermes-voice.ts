import type { JarvisAskResult } from '../../shared/speech-types'
import { resolveAdamHermesRuntime, type AdamHermesRuntime } from './adam-hermes-runtime'
import { readAdamVoiceSession, saveAdamVoiceSession } from './adam-hermes-session'
import {
  HermesDesktopRpc,
  HermesRpcError,
  type HermesDesktopEvent,
  type HermesRpc
} from './hermes-desktop-rpc'

type VoiceOptions = {
  sessionFile: string
  runtime?: () => AdamHermesRuntime | null | Promise<AdamHermesRuntime | null>
  connect?: (
    runtime: AdamHermesRuntime,
    onEvent: (event: HermesDesktopEvent) => void,
    onDisconnect: () => void
  ) => HermesRpc
  approve?: (command: string, description: string) => Promise<boolean>
  turnTimeoutMs?: number
}
type Turn = {
  resolve: (result: JarvisAskResult) => void
  timer: ReturnType<typeof setTimeout>
}

/** One voice conversation under Adam's real profile, independent of the open TUI and Telegram. */
export class AdamHermesVoice {
  private rpc: HermesRpc | null = null
  private sessionId: string | null = null
  private connecting: Promise<void> | null = null
  private retiring: Promise<void> = Promise.resolve()
  private generation = 0
  private turn: Turn | null = null

  constructor(private readonly options: VoiceOptions) {}

  ask(raw: string): Promise<JarvisAskResult> {
    const text = raw.trim()
    if (!text || text.length > 16_000) {
      return Promise.resolve({ kind: 'error', text: 'Voice request is empty or too long.' })
    }
    if (this.turn) {
      return Promise.resolve({ kind: 'error', text: 'Adam is already handling a voice request.' })
    }
    return new Promise((resolve) => {
      const turn: Turn = {
        resolve,
        timer: setTimeout(() => {
          this.finish({
            kind: 'error',
            text: 'Adam’s voice request timed out. Check the Hermes session before retrying.'
          })
          this.cancel()
        }, this.options.turnTimeoutMs ?? 180_000)
      }
      this.turn = turn
      void this.submit(text, turn).catch(() => {
        if (this.turn === turn) {
          this.finish({
            kind: 'error',
            text: 'Could not connect to Adam’s Hermes profile. Check that Hermes and the adam profile are installed and signed in.'
          })
          this.cancel()
        }
      })
    })
  }

  cancel(): void {
    this.generation += 1
    this.finish({ kind: 'cancelled', text: '' })
    const rpc = this.rpc
    const sessionId = this.sessionId
    this.rpc = null
    this.sessionId = null
    this.connecting = null
    if (rpc) {
      this.retiring = this.retiring.then(async () => {
        if (sessionId) {
          await rpc
            .request('session.interrupt', { session_id: sessionId }, 1_000)
            .catch(() => undefined)
          await rpc
            .request('session.close', { session_id: sessionId }, 1_000)
            .catch(() => undefined)
        }
        await rpc.close()
      })
    }
  }

  async close(): Promise<void> {
    this.cancel()
    await this.retiring
  }

  private async submit(text: string, turn: Turn): Promise<void> {
    await this.ensureSession()
    if (this.turn !== turn) {
      return
    }
    await this.rpc!.request('prompt.submit', { session_id: this.sessionId, text })
  }

  private async ensureSession(): Promise<void> {
    if (this.connecting) {
      return this.connecting
    }
    if (this.rpc && this.sessionId) {
      return
    }
    const generation = this.generation
    const pending = this.openSession(generation)
    this.connecting = pending
    try {
      await pending
    } finally {
      if (this.connecting === pending) {
        this.connecting = null
      }
    }
  }

  private async openSession(generation: number): Promise<void> {
    await this.retiring
    if (generation !== this.generation) {
      throw new Error('Cancelled')
    }
    const runtime = await (this.options.runtime ?? resolveAdamHermesRuntime)()
    if (generation !== this.generation) {
      throw new Error('Cancelled')
    }
    if (!runtime) {
      throw new Error('Adam profile unavailable')
    }
    const connect =
      this.options.connect ??
      ((r, onEvent, onDisconnect) => new HermesDesktopRpc(r, { onEvent, onDisconnect }))
    let rpc: HermesRpc | null = null
    rpc = connect(
      runtime,
      (event) => {
        if (rpc && this.rpc === rpc) {
          void this.onEvent(event, rpc)
        }
      },
      () => {
        if (rpc && this.rpc === rpc) {
          this.finish({ kind: 'error', text: 'Adam’s Hermes connection closed. Please try again.' })
          this.cancel()
        }
      }
    )
    this.rpc = rpc
    await rpc.ready
    if (generation !== this.generation || this.rpc !== rpc) {
      throw new Error('Cancelled')
    }
    await rpc.request('client.capabilities', { server_requests: true }).catch((error) => {
      if (!(error instanceof HermesRpcError) || error.code !== -32601) {
        throw error
      }
    })
    const stored = await readAdamVoiceSession(this.options.sessionFile, runtime.profileHome)
    if (generation !== this.generation || this.rpc !== rpc) {
      throw new Error('Cancelled')
    }
    let session: Record<string, unknown> | undefined
    if (stored) {
      try {
        session = await rpc.request('session.resume', { session_id: stored, profile: 'adam' })
      } catch (error) {
        if (!(error instanceof HermesRpcError) || error.code !== 4007) {
          throw error
        }
      }
    }
    if (!session) {
      session = await rpc.request('session.create', {
        title: 'Dobius voice — Adam',
        profile: 'adam'
      })
    }
    if (generation !== this.generation || this.rpc !== rpc) {
      throw new Error('Cancelled')
    }
    if (typeof session.session_id !== 'string') {
      throw new Error('Missing Hermes session')
    }
    this.sessionId = session.session_id
    const key = session.stored_session_id ?? session.resumed
    if (typeof key === 'string') {
      await saveAdamVoiceSession(this.options.sessionFile, runtime.profileHome, key)
    }
  }

  private async onEvent(event: HermesDesktopEvent, rpc: HermesRpc): Promise<void> {
    if (!this.turn || event.session_id !== this.sessionId) {
      event.respond?.(event.type === 'approval.request' ? { choice: 'deny' } : {})
      return
    }
    const payload = event.payload ?? {}
    if (event.type === 'message.complete') {
      const text = typeof payload.text === 'string' ? payload.text.trim() : ''
      this.finish(
        payload.status === 'complete' && text
          ? { kind: 'answer', text }
          : {
              kind: 'error',
              text: 'Adam could not finish that voice request. Check the Hermes session for details.'
            }
      )
    } else if (event.type === 'error') {
      this.finish({
        kind: 'error',
        text: 'Adam could not complete that voice request. Check the Hermes provider connection.'
      })
      this.cancel()
    } else if (event.type === 'approval.request') {
      const turn = this.turn
      const approved =
        typeof payload.command === 'string' &&
        (await this.options
          .approve?.(payload.command, String(payload.description ?? ''))
          .catch(() => false))
      if (this.turn === turn && this.rpc === rpc) {
        const choice = approved ? 'once' : 'deny'
        if (event.respond) {
          event.respond({ choice })
        } else {
          await rpc
            .request('approval.respond', { session_id: this.sessionId, choice })
            .catch(() => this.cancel())
        }
      }
    } else if (['clarify.request', 'sudo.request', 'secret.request'].includes(event.type)) {
      event.respond?.(event.type === 'clarify.request' ? {} : { value: '' })
      this.finish({
        kind: 'error',
        text: 'Adam needs additional input. Please continue this request in the Hermes terminal.'
      })
      this.cancel()
    }
  }

  private finish(result: JarvisAskResult): void {
    const turn = this.turn
    if (!turn) {
      return
    }
    this.turn = null
    clearTimeout(turn.timer)
    turn.resolve(result)
  }
}
