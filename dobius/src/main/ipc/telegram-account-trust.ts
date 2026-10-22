import type { IpcMainInvokeEvent } from 'electron'

/** Restricts personal-account controls to the current desktop settings window. */
export class TelegramAccountRendererTrust {
  private rendererId: number | null = null
  private revision = 0

  setRenderer(id: number | null): void {
    this.rendererId = id
    this.revision += 1
  }

  capture(event: IpcMainInvokeEvent): () => void {
    const revision = this.revision
    const assertCurrent = (): void => {
      // Recheck after asynchronous work: a replacement window must not inherit
      // an earlier window's account-control operation or response.
      if (
        revision !== this.revision ||
        this.rendererId === null ||
        event.sender.id !== this.rendererId ||
        event.sender.isDestroyed() ||
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.detached
      ) {
        throw new Error('Telegram accounts can only be managed from desktop settings.')
      }
    }
    assertCurrent()
    return assertCurrent
  }
}
