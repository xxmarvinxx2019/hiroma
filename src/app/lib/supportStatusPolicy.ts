export type SupportTicketStatus = 'new' | 'reviewing' | 'resolved'

export function canTransitionSupportTicketStatus(
  currentStatus: SupportTicketStatus,
  nextStatus: SupportTicketStatus,
) {
  if (currentStatus === 'resolved') return nextStatus === 'resolved'
  return true
}
