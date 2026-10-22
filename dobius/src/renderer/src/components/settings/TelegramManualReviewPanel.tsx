import { useMemo, useState } from 'react'
import type { TelegramManualReviewReceipt } from '../../../../shared/telegram-account-api'
import { Button } from '../ui/button'
import { formatTelegramActivity } from './telegram-account-ui'

const PAGE_SIZE = 20
export function TelegramManualReviewPanel({
  receipts
}: {
  receipts: TelegramManualReviewReceipt[]
}): React.JSX.Element | null {
  const [requestedPage, setPage] = useState(0)
  const sorted = useMemo(
    () => [...receipts].sort((a, b) => b.admittedAt - a.admittedAt),
    [receipts]
  )
  if (receipts.length === 0) {
    return null
  }
  const pages = Math.ceil(sorted.length / PAGE_SIZE)
  const page = Math.min(requestedPage, pages - 1)
  const visible = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <h4 className="text-sm font-medium">Messages needing manual review ({receipts.length})</h4>
      <p className="text-xs text-muted-foreground">
        These messages have no confirmed reply draft. Review them in Telegram. Dobius will not retry
        uncertain work automatically.
      </p>
      <ul
        aria-label="Telegram messages needing manual review"
        className="space-y-2 text-xs text-muted-foreground"
      >
        {visible.map((receipt) => (
          <li key={`${receipt.groupId}:${receipt.messageId}`}>
            {receipt.groupTitle} · Message {receipt.messageId} ·{' '}
            {formatTelegramActivity(receipt.admittedAt)}
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Newer messages
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {pages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === pages - 1}
            onClick={() => setPage(page + 1)}
          >
            Older messages
          </Button>
        </div>
      ) : null}
    </div>
  )
}
