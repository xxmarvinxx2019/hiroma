export const SUPPORT_TICKET_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export function getSupportTicketRetentionCutoff(now = Date.now()) {
  return new Date(now - SUPPORT_TICKET_RETENTION_MS)
}
