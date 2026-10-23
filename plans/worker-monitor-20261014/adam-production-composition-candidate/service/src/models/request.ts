import { z } from 'zod'

const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.unknown())]),
  name: z.string().optional(),
  tool_call_id: z.string().optional()
}).passthrough()

export const ModelRouteRequestSchema = z.object({
  senderId: z.literal('carson'),
  requestId: z.string().min(1).max(200),
  taskClass: z.string().min(1).max(80).optional(),
  model: z.string().min(1).max(200).optional(),
  messages: z.array(MessageSchema).min(1).max(500),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(200_000).optional(),
  sessionId: z.string().min(1).max(200).optional()
})

export type ModelRouteRequest = z.infer<typeof ModelRouteRequestSchema>
