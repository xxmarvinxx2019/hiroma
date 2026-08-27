export const POS_TRANSACTION_TYPES = ['member_sale', 'non_member_sale', 'new_reseller_registration'] as const
export const POS_TRANSACTION_STATUSES = ['pending_sync', 'syncing', 'synced_pending_review', 'approved', 'needs_correction', 'rejected', 'finalized', 'voided', 'refunded'] as const

export type PosTransactionStatus = (typeof POS_TRANSACTION_STATUSES)[number]

const transitions: Record<PosTransactionStatus, readonly PosTransactionStatus[]> = {
  pending_sync: ['syncing'],
  syncing: ['pending_sync', 'synced_pending_review', 'approved', 'needs_correction'],
  synced_pending_review: ['approved', 'needs_correction', 'rejected'],
  approved: ['finalized'],
  needs_correction: ['pending_sync', 'rejected'],
  rejected: [],
  finalized: ['voided', 'refunded'],
  voided: [],
  refunded: [],
}

export function canTransitionPosTransaction(from: PosTransactionStatus, to: PosTransactionStatus): boolean {
  return transitions[from].includes(to)
}

export function availableOfflineQuantity(allocated: number, consumed: number): number {
  if (!Number.isSafeInteger(allocated) || !Number.isSafeInteger(consumed) || allocated < 0 || consumed < 0) return 0
  return Math.max(0, allocated - consumed)
}

export function validateOfflineQuantity(input: { allocated: number; consumed: number; requested: number }): string | null {
  if (!Number.isSafeInteger(input.requested) || input.requested <= 0) return 'Quantity must be a positive whole number.'
  const available = availableOfflineQuantity(input.allocated, input.consumed)
  if (input.requested > available) return `Only ${available} unit${available === 1 ? '' : 's'} are available for offline selling on this terminal.`
  return null
}

export function shouldFinalizeImmediately(type: (typeof POS_TRANSACTION_TYPES)[number]): boolean {
  return type !== 'new_reseller_registration'
}
