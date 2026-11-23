import type { JarvisAskResult } from '../../shared/speech-types'
import { resolveAdamHermesRuntime } from './adam-hermes-runtime'
import { readAdamVoiceSession, saveAdamVoiceSession } from './adam-hermes-session'
import type { AdamHermesTurn, AdamHermesVoiceOptions } from './adam-hermes-voice-types'
import { contextPercentOf, progressStepOf } from './adam-progress'
import { compactNow } from './adam-idle-tidy'
import {
  HermesDesktopRpc,
  HermesRpcError,
  type HermesDesktopEvent,
  type HermesRpc
} from './hermes-desktop-rpc'

export const ADAM_TURN_TIMEOUT_TEXT =
  'ADAM went too long without answering, so Dobius+ stopped the request. Send your message again.'
export const ADAM_COMPACTION_TIMEOUT_TEXT =
  'ADAM was tidying his memory for much longer than usual, so Dobius+ stopped the request. Send your message again.'

/** One voice conversation under Adam's real profile, independent of the open TUI and Telegram. */
export class AdamHermesVoice {
  private rpc: HermesRpc | null = null
  private sessionId: string | null = null
  private connecting: Promise<void> | null = null
  private retiring: Promise<void> = Promise.resolve()
  private generation = 0
  private turn: AdamHermesTurn | null = null
  private tidying: Promise<unknown> | null = null
  private context: number | null = null

  constructor(private readonly options: AdamHermesVoiceOptions) {}

  ask(raw: string): Promise<JarvisAskResult> {
    const text = raw.trim()
    if (!text || text.length > 16_000) {
      return Promise.resolve({ kind: 'error', text: 'Voice request is empty or too long.' })
    }
    if (this.turn) {
      return Promise.resolve({ kind: 'error', text: 'Adam is already handling a voice request.' })
    }
    return new Promise((resolve) => {
      const turn: AdamHermesTurn = { resolve, compacting: false }
      this.armTimer(turn)
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

  /** How full ADAM's context was at Hermes' last usage report, in percent; null = never reported. */
  get contextPercent(): number | null {
    return this.context
  }

  /**
   * Idle-time memory tidy (adam-idle-tidy.ts): asks Hermes to compact now.
   * False, without asking, while a turn runs or no session is open.
   */
  async tidy(): Promise<boolean> {
    if (!this.rpc || !this.sessionId || this.turn || this.tidying) {
      return false
    }
    const run = compactNow(this.rpc, this.sessionId, this.options)
    this.tidying = run
    try {
      this.context = (await run) ?? this.context
      return true
    } finally {
      this.tidying = null
    }
  }

  /** True while Hermes is compacting ADAM's context inside the running turn. */
  get compacting(): boolean {
    return this.turn?.compacting ?? false
  }

  /**
   * Why two budgets: a compaction is one long summarizing call (2–3 minutes on
   * a full session) that ends the turn's progress until it commits. Cutting it
   * off saved nothing, so the next message compacted again, forever. While
   * Hermes says it is compacting, the turn gets the compaction budget; once
   * that ends, a fresh turn budget.
   */
  private armTimer(turn: AdamHermesTurn): void {
    clearTimeout(turn.timer)
    turn.timer = setTimeout(
      () => {
        this.finish({
          kind: 'error',
          text: turn.compacting ? ADAM_COMPACTION_TIMEOUT_TEXT : ADAM_TURN_TIMEOUT_TEXT
        })
        this.cancel()
      },
      turn.compacting
        ? (this.options.compactionTimeoutMs ?? 720_000)
        : (this.options.turnTimeoutMs ?? 180_000)
    )
  }

  private setCompacting(turn: AdamHermesTurn, compacting: boolean): void {
    if (turn.compacting === compacting) {
      return
    }
    turn.compacting = compacting
    this.armTimer(turn)
    this.options.onCompacting?.(compacting)
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

  private async submit(text: string, turn: AdamHermesTurn): Promise<void> {
    await this.ensureSession()
    if (this.tidying) {
      // Why wait: an idle tidy is still compacting; the turn gets its budget.
      this.setCompacting(turn, true)
      await this.tidying.catch(() => undefined)
      this.setCompacting(turn, false)
    }
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
    if (event.session_id === this.sessionId) {
      this.context = contextPercentOf(event.payload) ?? this.context
    }
    if (!this.turn || event.session_id !== this.sessionId) {
      event.respond?.(event.type === 'approval.request' ? { choice: 'deny' } : {})
      return
    }
    const payload = event.payload ?? {}
    const step = progressStepOf(event)
    if (step) {
      this.options.onProgress?.(step)
    }
    // Hermes re-tags every in-progress compaction line (preflight, idle, heartbeat)
    // as kind "compacting" and ends it with "compacted" (tui_gateway/server.py _status_update).
    if (event.type === 'status.update') {
      if (payload.kind === 'compacting') {
        this.setCompacting(this.turn, true)
      } else if (payload.kind === 'compacted') {
        this.setCompacting(this.turn, false)
      }
      return
    }
    if (this.turn.compacting && event.type === 'message.delta') {
      // Why: a reply streaming means the compaction is over even if its end edge was lost.
      this.setCompacting(this.turn, false)
    }
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
    if (turn.compacting) {
      turn.compacting = false
      this.options.onCompacting?.(false)
    }
    turn.resolve(result)
  }
}
