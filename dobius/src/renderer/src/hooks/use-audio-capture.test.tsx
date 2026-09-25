// @vitest-environment happy-dom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useAudioCapture } from './use-audio-capture'

type Capture = ReturnType<typeof useAudioCapture>

let root: Root | null = null
let container: HTMLDivElement | null = null
const seen: Capture[] = []
let bump: (() => void) | null = null

function Probe(): null {
  const [, setTick] = useState(0)
  bump = () => setTick((tick) => tick + 1)
  seen.push(useAudioCapture())
  return null
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
  }
  root = null
  container?.remove()
  container = null
  seen.length = 0
  bump = null
})

describe('useAudioCapture', () => {
  it('returns the same controls object across re-renders (#82)', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<Probe />)
    })
    await act(async () => {
      bump?.()
    })
    await act(async () => {
      bump?.()
    })

    expect(seen.length).toBeGreaterThanOrEqual(3)
    for (const capture of seen) {
      expect(capture).toBe(seen[0])
    }
  })
})
