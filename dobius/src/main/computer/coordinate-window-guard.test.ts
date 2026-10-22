import { describe, expect, it, vi } from 'vitest'
import { requireWindowForCoordinateAction } from './coordinate-window-guard'

const windows = (count: number, minimized = 0) =>
  vi.fn(async () => ({
    app: { name: 'Chrome' },
    windows: Array.from({ length: count }, (_, index) => ({
      index,
      title: `w${index}`,
      width: 100,
      height: 100,
      isMinimized: index < minimized
    }))
  })) as never

describe('coordinate actions with several windows open', () => {
  it('refuses an unpinned coordinate click when the app has several windows', async () => {
    await expect(
      requireWindowForCoordinateAction('click', { app: 'chrome', x: 10, y: 10 }, windows(3))
    ).rejects.toThrow('3 windows are open')
  })

  it('allows the click once a window is named, or when only one window is open', async () => {
    const list = windows(3)
    await requireWindowForCoordinateAction('click', { app: 'c', x: 1, y: 1, windowId: 7 }, list)
    expect(list).not.toHaveBeenCalled()
    await requireWindowForCoordinateAction('click', { app: 'c', x: 1, y: 1 }, windows(2, 1))
  })

  it('never checks element-index clicks, keyboard actions or element drags', async () => {
    const list = windows(3)
    await requireWindowForCoordinateAction('click', { app: 'c', elementIndex: 4 }, list)
    await requireWindowForCoordinateAction('pressKey', { app: 'c', key: 'Return' }, list)
    await requireWindowForCoordinateAction('drag', { app: 'c', fromElementIndex: 1 }, list)
    expect(list).not.toHaveBeenCalled()
  })

  it('also guards coordinate scrolls and drags', async () => {
    await expect(
      requireWindowForCoordinateAction('drag', { app: 'c', fromX: 1, fromY: 1 }, windows(2))
    ).rejects.toThrow('coordinate drag')
  })
})
