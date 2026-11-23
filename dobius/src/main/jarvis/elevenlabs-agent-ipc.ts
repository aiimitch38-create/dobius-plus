// The ElevenLabs live agent's IPC: context, memory and the signed URL.
import { ipcMain } from 'electron'
import { join } from 'node:path'
import type { Store } from '../persistence'
import { getUserDataRoot } from '../storage/user-data-root'
import { buildAgentContext, buildOpeningLine, runDobiusCommand } from './agent-context'
import { fetchRecentConversationSummaries, formatConversationMemory } from './conversation-memory'
import { fetchAgentSignedUrl } from './elevenlabs-agent'
import { resolveElevenLabsApiKey } from './elevenlabs-key-store'

export function registerElevenLabsAgentHandlers(store: Store): void {
  // Live agent: the renderer owns the websocket (it has the mic and speakers),
  // main only mints the signed URL so the API key never leaves this process.
  ipcMain.removeHandler('jarvis:agentContext')
  ipcMain.handle('jarvis:agentContext', () =>
    buildAgentContext(join(getUserDataRoot(), 'terminal-history'))
  )

  // Why a separate call from agentContext: this hits the ElevenLabs API, so it
  // is fetched after the call connects rather than delaying the connection.
  ipcMain.removeHandler('jarvis:conversationMemory')
  ipcMain.handle('jarvis:conversationMemory', async () => {
    const voice = store.getSettings().voice
    const summaries = await fetchRecentConversationSummaries(
      resolveElevenLabsApiKey(voice),
      voice?.elevenlabsAgentId ?? ''
    )
    return formatConversationMemory(summaries)
  })

  ipcMain.removeHandler('jarvis:agentOpening')
  ipcMain.handle('jarvis:agentOpening', () =>
    buildOpeningLine(join(getUserDataRoot(), 'terminal-history'))
  )

  ipcMain.removeHandler('jarvis:runDobius')
  ipcMain.handle('jarvis:runDobius', (_event, command: string) =>
    runDobiusCommand(typeof command === 'string' ? command : '')
  )

  ipcMain.removeHandler('jarvis:agentSignedUrl')
  ipcMain.handle('jarvis:agentSignedUrl', () => {
    const voice = store.getSettings().voice
    return fetchAgentSignedUrl(resolveElevenLabsApiKey(voice), voice?.elevenlabsAgentId ?? '')
  })
}
