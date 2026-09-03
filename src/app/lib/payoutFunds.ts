import type { Prisma } from '@prisma/client'
import { appendWalletLedgerEntryExactlyOnce, lockFinancialUser } from '@/app/lib/walletLedger'

type PayoutTx = Prisma.TransactionClient

export class InsufficientPayoutFundsError extends Error {
  constructor() {
    super('Insufficient unreserved wallet balance.')
    this.name = 'InsufficientPayoutFundsError'
  }
}

export async function lockPayoutRequestsForUser(tx: PayoutTx, userId: string) {
  await lockFinancialUser(tx, userId)
}

export async function reservePayoutFunds(tx: PayoutTx, payoutId: string, userId: string, amount: number) {
  try {
    await appendWalletLedgerEntryExactlyOnce(tx, {
      eventKey: `payout:${payoutId}:reservation`,
      userId,
      entryType: 'payout_reservation',
      reservedDelta: amount,
      payoutId,
      sourceKind: 'payout',
      sourceEventId: payoutId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('source-backed withdrawable funds') || message.includes('wallet balance invariants')) {
      throw new InsufficientPayoutFundsError()
    }
    throw error
  }
}

export async function releasePayoutFunds(tx: PayoutTx, payoutId: string, userId: string, amount: number) {
  await appendWalletLedgerEntryExactlyOnce(tx, {
    eventKey: `payout:${payoutId}:reservation-release`,
    userId,
    entryType: 'payout_reservation_release',
    reservedDelta: -amount,
    payoutId,
    sourceKind: 'payout',
    sourceEventId: payoutId,
  })
}

export async function finalizePayoutFunds(tx: PayoutTx, payoutId: string, userId: string, amount: number) {
  await appendWalletLedgerEntryExactlyOnce(tx, {
    eventKey: `payout:${payoutId}:disbursement`,
    userId,
    entryType: 'payout_disbursement',
    balanceDelta: -amount,
    reservedDelta: -amount,
    totalWithdrawnDelta: amount,
    payoutId,
    sourceKind: 'payout',
    sourceEventId: payoutId,
  })
}
