// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TelegramManualReviewPanel } from './TelegramManualReviewPanel'

afterEach(cleanup)
describe('Telegram uncertain admission visibility', () => {
  it('shows durable message metadata and no invented retry control', () => {
    render(
      <TelegramManualReviewPanel
        receipts={[
          {
            groupId: '-101',
            groupTitle: 'Client group',
            messageId: '22',
            admittedAt: 1800000000000
          }
        ]}
      />
    )
    expect(screen.getByText('Messages needing manual review (1)')).toBeTruthy()
    expect(screen.getByText(/Client group · Message 22/)).toBeTruthy()
    expect(screen.getByText(/will not retry uncertain work automatically/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })
  it('paginates every receipt with newest first and keeps old receipts reachable', () => {
    const receipts = Array.from({ length: 23 }, (_, index) => ({
      groupId: '-101',
      groupTitle: 'Client group',
      messageId: String(index + 1),
      admittedAt: 1800000000000 + index
    }))
    render(<TelegramManualReviewPanel receipts={receipts} />)
    let rows = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(rows).toHaveLength(20)
    expect(rows[0].textContent).toContain('Message 23')
    fireEvent.click(screen.getByRole('button', { name: 'Older messages' }))
    rows = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows.at(-1)?.textContent).toContain('Message 1')
    expect(
      (screen.getByRole('button', { name: 'Older messages' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
  it('renders no warning when there is no uncertain work', () => {
    const view = render(<TelegramManualReviewPanel receipts={[]} />)
    expect(view.container.textContent).toBe('')
  })
})
