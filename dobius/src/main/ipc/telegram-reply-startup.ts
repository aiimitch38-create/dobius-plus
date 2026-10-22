import type { TelegramAccountService } from '../telegram-account/service'
import type { AdamReplyGateway } from '../telegram-account/adam-reply-gateway'

/** Every awaited startup remains bound to the account, selection and latest human control. */
export class TelegramReplyStartup {
  private epoch = 0
  constructor(
    private readonly service: TelegramAccountService,
    private readonly gateway: AdamReplyGateway
  ) {}

  invalidate(): void {
    this.epoch += 1
  }

  async stop(): Promise<void> {
    this.invalidate()
    const epoch = this.epoch
    await this.service.stopReplies()
    if (this.epoch === epoch) {
      await this.gateway.stop()
    }
  }

  async start(): Promise<void> {
    const initial = this.capture()
    const epoch = ++this.epoch
    await this.gateway.start()
    if (this.epoch !== epoch) {
      throw new Error('stale-operation')
    }
    try {
      const current = this.capture()
      if (current !== initial) {
        throw new Error('stale-operation')
      }
      const result = await this.service.startReplies()
      if (this.epoch !== epoch) {
        throw new Error('stale-operation')
      }
      if (!result.ok) {
        throw new Error(result.error)
      }
    } catch (error) {
      if (this.epoch === epoch) {
        await this.stop()
      }
      throw error
    }
  }

  private capture(): string {
    const accountId = this.service.getAccountId()
    const account = this.service.snapshot()
    if (!account.connected || account.paused || account.selectedGroups.length !== 3 || !accountId) {
      throw new Error('group-selection-required')
    }
    return JSON.stringify([
      accountId,
      account.selectedGroups.map((group) => [group.id, group.kind, group.title]).sort()
    ])
  }
}
