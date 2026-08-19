/**
 * Durable JSON-file store for channel templates. Mirrors team-store.ts:
 * one array file at userData/channel-templates.json, atomic
 * write-to-tmp-then-rename, module-level cache invalidated per-process by
 * `vi.resetModules()` in tests. See channel-template-record.ts's top
 * comment for why one file (not one file per template) instead of
 * per-record files.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import {
  assertValidTemplateName,
  cloneChannelTemplate,
  normalizeCanvasTemplate,
  normalizeChannelType,
  normalizeTemplateAgents,
  normalizeVisibility,
  sanitizeChannelTemplateRow,
  type ChannelTemplate,
  type ChannelTemplateInput,
  type ChannelTemplateUpdate
} from './channel-template-record'

const FILE_NAME = 'channel-templates.json'

let cached: ChannelTemplate[] | null = null

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function load(): ChannelTemplate[] {
  if (cached) {return cached}
  try {
    const raw = JSON.parse(readFileSync(filePath(), 'utf-8'))
    cached = Array.isArray(raw) ? raw.map(sanitizeChannelTemplateRow).filter((row): row is ChannelTemplate => row !== null) : []
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') {
      console.warn('[channel-templates] failed to load channel templates:', error instanceof Error ? error.message : String(error))
    }
    cached = []
  }
  return cached
}

function persist(templates: ChannelTemplate[]): void {
  const target = filePath()
  const tmp = `${target}.${process.pid}.tmp`
  try {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(tmp, `${JSON.stringify(templates, null, 2)}\n`, 'utf-8')
    renameSync(tmp, target)
  } catch (error) {
    console.warn('[channel-templates] failed to persist channel templates:', error instanceof Error ? error.message : String(error))
  }
}

export function listChannelTemplates(): ChannelTemplate[] {
  return load().map(cloneChannelTemplate)
}

export function getChannelTemplate(id: string): ChannelTemplate | null {
  const template = load().find((entry) => entry.id === id)
  return template ? cloneChannelTemplate(template) : null
}

export function createChannelTemplate(input: ChannelTemplateInput): ChannelTemplate[] {
  const name = input.name.trim()
  assertValidTemplateName(name)
  const now = Date.now()
  const templates = load()
  templates.push({
    id: randomUUID(),
    name,
    description: typeof input.description === 'string' ? input.description.trim() || null : null,
    channelType: normalizeChannelType(input.channelType),
    visibility: normalizeVisibility(input.visibility),
    canvasTemplate: normalizeCanvasTemplate(input.canvasTemplate),
    agents: normalizeTemplateAgents(input.agents),
    createdAt: now,
    updatedAt: now
  })
  cached = templates
  persist(templates)
  return listChannelTemplates()
}

export function updateChannelTemplate(id: string, updates: ChannelTemplateUpdate): ChannelTemplate[] {
  const templates = load()
  const template = templates.find((entry) => entry.id === id)
  if (!template) {
    throw new Error('Channel template not found')
  }
  if (updates.name !== undefined) {
    assertValidTemplateName(updates.name)
    template.name = updates.name.trim()
  }
  if (updates.description !== undefined) {
    template.description = updates.description?.trim() || null
  }
  if (updates.channelType !== undefined) {
    template.channelType = normalizeChannelType(updates.channelType, template.channelType)
  }
  if (updates.visibility !== undefined) {
    template.visibility = normalizeVisibility(updates.visibility, template.visibility)
  }
  if (updates.canvasTemplate !== undefined) {
    template.canvasTemplate = normalizeCanvasTemplate(updates.canvasTemplate)
  }
  if (updates.agents !== undefined) {
    template.agents = normalizeTemplateAgents(updates.agents)
  }
  template.updatedAt = Date.now()
  cached = templates
  persist(templates)
  return listChannelTemplates()
}

export function removeChannelTemplate(id: string): ChannelTemplate[] {
  cached = load().filter((template) => template.id !== id)
  persist(cached)
  return listChannelTemplates()
}

/** Deep-clones an existing template under a new id, appending " (Copy)" to
 * the name so the duplicate is distinguishable in a list without the
 * caller needing to rename it immediately. */
export function duplicateChannelTemplate(id: string): ChannelTemplate[] {
  const source = getChannelTemplate(id)
  if (!source) {
    throw new Error('Channel template not found')
  }
  const now = Date.now()
  const templates = load()
  templates.push({
    ...cloneChannelTemplate(source),
    id: randomUUID(),
    name: `${source.name} (Copy)`,
    createdAt: now,
    updatedAt: now
  })
  cached = templates
  persist(templates)
  return listChannelTemplates()
}
