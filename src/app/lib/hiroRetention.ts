import { HIRO_INACTIVITY_MS } from '@/app/lib/hiroConversation'

export const HIRO_CHAT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export function getHiroRetentionCutoffs(now = Date.now()) {
  return {
    closedBefore: new Date(now - HIRO_CHAT_RETENTION_MS),
    abandonedBefore: new Date(now - HIRO_CHAT_RETENTION_MS - HIRO_INACTIVITY_MS),
  }
}
