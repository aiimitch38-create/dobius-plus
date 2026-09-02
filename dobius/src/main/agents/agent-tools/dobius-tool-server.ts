import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { Store } from '../../persistence'
import { appendStoredAgentRunOutbox } from '../agent-runs-store'
import { createDobiusToolHandlers, type DobiusToolContext } from './dobius-tool-handlers'

// Raw-file ceiling for screenshots posted into chat. The image travels as a
// data: URI inside a relay event, so this bounds both the runs store and the
// relay's sqlite row. Full-page captures should be scaled down by the agent.
const MAX_CHAT_IMAGE_BYTES = 1_200_000

const CHAT_IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] }
}

function queueOutboxItem(
  context: DobiusToolContext,
  content: string,
  imageDataUrl?: string
): CallToolResult {
  const run = appendStoredAgentRunOutbox(context.runId, {
    id: randomUUID(),
    content,
    ...(imageDataUrl ? { imageDataUrl } : {}),
    createdAt: Date.now()
  })
  if (!run) {
    return textResult('Failed: this run is no longer tracked, the message was not sent.')
  }
  return textResult('Queued for the channel — it will appear in the chat within a second.')
}

let knowledgeStore: Store | null = null

export type { DobiusToolContext }

export function setDobiusToolKnowledgeStore(store: Store): void {
  knowledgeStore = store
}

function asCallToolResult(
  result: Awaited<
    ReturnType<
      ReturnType<typeof createDobiusToolHandlers>[keyof ReturnType<typeof createDobiusToolHandlers>]
    >
  >
): CallToolResult {
  return result
}

export function buildDobiusToolServer(context: DobiusToolContext): McpSdkServerConfigWithInstance {
  const handlers = createDobiusToolHandlers(context, knowledgeStore)
  const channelTools = context.channelOutbox
    ? [
        tool(
          'post_channel_message',
          'Post a message into the Communications channel this run was started from, immediately — use it to narrate progress or talk to other agents before your run finishes. Mention @AgentName to bring another agent in.',
          { message: z.string().min(1) },
          async (args) => queueOutboxItem(context, args.message)
        ),
        tool(
          'post_channel_screenshot',
          'Post an image file (png/jpg/webp/gif, up to ~1MB — scale big captures down first) into the Communications channel this run was started from, with an optional caption. Use it to share screenshots so the user and other agents can verify work.',
          { path: z.string().min(1), caption: z.string().optional() },
          async (args) => {
            const filePath = path.resolve(args.path)
            const ext = path.extname(filePath).toLowerCase()
            const mime = CHAT_IMAGE_MIME[ext]
            if (!mime) {
              return textResult(`Failed: unsupported image type "${ext}" — use png/jpg/webp/gif.`)
            }
            let size: number
            try {
              size = statSync(filePath).size
            } catch {
              return textResult(`Failed: no file at ${filePath}.`)
            }
            if (size > MAX_CHAT_IMAGE_BYTES) {
              return textResult(
                `Failed: ${Math.round(size / 1024)}KB exceeds the ${Math.round(MAX_CHAT_IMAGE_BYTES / 1024)}KB chat limit — scale the image down and retry.`
              )
            }
            const dataUrl = `data:${mime};base64,${readFileSync(filePath).toString('base64')}`
            return queueOutboxItem(context, args.caption ?? '', dataUrl)
          }
        )
      ]
    : []
  return createSdkMcpServer({
    name: 'dobius',
    version: '1.0.0',
    tools: [
      ...channelTools,
      tool(
        'asana_draft_comment',
        'Queue a draft Asana comment for human approval. Never posts to Asana.',
        { gid: z.string(), body: z.string() },
        async (args) => asCallToolResult(await handlers.asanaDraftComment(args))
      ),
      tool(
        'dispatch_build',
        'Create a managed build worktree with a startup brief. Never pushes, merges, posts, or completes tasks.',
        { repo: z.string(), brief: z.string(), branchName: z.string().optional() },
        async (args) => asCallToolResult(await handlers.dispatchBuild(args))
      ),
      tool(
        'read_knowledge',
        'Read allowed Dobius knowledge by leaf id or title/summary query.',
        { query: z.string(), leafId: z.string().optional() },
        async (args) => asCallToolResult(await handlers.readKnowledge(args))
      ),
      tool(
        'list_crew',
        'List configured crew agents and compact capability metadata.',
        {},
        async () => asCallToolResult(await handlers.listCrew())
      ),
      tool(
        'crew_status',
        'Summarize the current and latest known run status for each crew agent.',
        {},
        async () => asCallToolResult(await handlers.crewStatus())
      ),
      tool(
        'file_briefing_item',
        'Surface a finding to the human briefing without posting externally.',
        { urgency: z.enum(['digest', 'now']), summary: z.string() },
        async (args) => asCallToolResult(await handlers.fileBriefingItem(args))
      )
    ]
  })
}
