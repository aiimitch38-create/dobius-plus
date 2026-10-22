import { ipcRenderer } from 'electron'
import type { TelegramAccountApi } from '../shared/telegram-account-api'

export const telegramAccountApi: TelegramAccountApi = {
  getSnapshot: () => ipcRenderer.invoke('telegramAccount:getSnapshot'),
  beginSignIn: (input) => ipcRenderer.invoke('telegramAccount:beginSignIn', input),
  submitCode: (input) => ipcRenderer.invoke('telegramAccount:submitCode', input),
  submitPassword: (input) => ipcRenderer.invoke('telegramAccount:submitPassword', input),
  cancelSignIn: () => ipcRenderer.invoke('telegramAccount:cancelSignIn'),
  refreshGroups: () => ipcRenderer.invoke('telegramAccount:refreshGroups'),
  saveGroups: (input) => ipcRenderer.invoke('telegramAccount:saveGroups', input),
  getParticipants: (input) => ipcRenderer.invoke('telegramAccount:getParticipants', input),
  grantConsent: (input) => ipcRenderer.invoke('telegramAccount:grantConsent', input),
  revokeConsent: (input) => ipcRenderer.invoke('telegramAccount:revokeConsent', input),
  startReplies: () => ipcRenderer.invoke('telegramAccount:startReplies'),
  stopReplies: () => ipcRenderer.invoke('telegramAccount:stopReplies'),
  approveDraft: (input) => ipcRenderer.invoke('telegramAccount:approveDraft', input),
  sendDraft: (input) => ipcRenderer.invoke('telegramAccount:sendDraft', input),
  pause: () => ipcRenderer.invoke('telegramAccount:pause'),
  resume: () => ipcRenderer.invoke('telegramAccount:resume'),
  disconnect: () => ipcRenderer.invoke('telegramAccount:disconnect'),
  revoke: () => ipcRenderer.invoke('telegramAccount:revoke')
}
