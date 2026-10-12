import path from 'node:path'
import type { DobiusPrompt } from '../../shared/prompts'
import { parseEveryEntry, SafeJsonFile } from '../storage/safe-json-file'
import { getUserDataRoot } from '../storage/user-data-root'

// Reusable prompt snippets, self-owned JSON in userData (out of GlobalSettings,
// same atomic tmp+rename pattern as the Asana config).
const FILE_NAME = 'prompts.json'

function filePath(): string {
  return path.join(getUserDataRoot(), FILE_NAME)
}

// Why: a malformed entry makes the whole file unreadable instead of being
// dropped and then saved over (CX12 F2).
function sanitizePrompt(entry: unknown): DobiusPrompt | null {
  if (typeof entry !== 'object' || entry === null) {
    return null
  }
  const record = entry as Partial<Record<keyof DobiusPrompt, unknown>>
  const id = typeof record.id === 'string' ? record.id : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const text = typeof record.text === 'string' ? record.text : ''
  const createdAt = typeof record.createdAt === 'number' ? record.createdAt : 0
  if (!id || !title || !text) {
    return null
  }
  return { id, title, text, createdAt }
}

const file = new SafeJsonFile<DobiusPrompt[]>({
  filePath,
  parse: (raw) => (Array.isArray(raw) ? parseEveryEntry(raw, sanitizePrompt) : undefined),
  fallback: () => [],
  label: `[prompts] ${FILE_NAME}`
})

function load(): DobiusPrompt[] {
  return file.get()
}

// Why: throws so the renderer's error path shows a refused save instead of
// an edit that silently disappears on restart.
function persist(prompts: DobiusPrompt[]): void {
  file.save(prompts)
}

export function listPrompts(): DobiusPrompt[] {
  return load().map((p) => ({ ...p }))
}

export function savePrompt(input: { id?: string; title: string; text: string }): DobiusPrompt[] {
  const title = input.title.trim()
  const text = input.text
  if (!title || !text.trim()) {
    return listPrompts()
  }
  const prompts = load()
  const existing = input.id ? prompts.find((p) => p.id === input.id) : undefined
  if (existing) {
    existing.title = title
    existing.text = text
  } else {
    prompts.push({
      id: `prompt-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      title,
      text,
      createdAt: Date.now()
    })
  }
  persist(prompts)
  return listPrompts()
}

export function deletePrompt(id: string): DobiusPrompt[] {
  persist(load().filter((p) => p.id !== id))
  return listPrompts()
}
