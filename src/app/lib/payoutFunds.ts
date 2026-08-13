import type { Prisma } from '@prisma/client'

type PayoutTx = Prisma.TransactionClient

export class InsufficientPayoutFundsError extends Error {
  constructor() {
    super('Insufficient unreserved wallet balance.')
    this.name = 'InsufficientPayoutFundsError'
  }
}

export async function lockPayoutRequestsForUser(tx: PayoutTx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`
}

export async function reservePayoutFunds(tx: PayoutTx, userId: string, amount: number) {
  const changed = await tx.$executeRaw`
    UPDATE "wallets"
    SET "reserved_balance" = "reserved_balance" + ${amount},
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "user_id" = ${userId}
      AND ("balance" - "reserved_balance") >= ${amount}
  `
  if (changed !== 1) throw new InsufficientPayoutFundsError()
}

export async function releasePayoutFunds(tx: PayoutTx, userId: string, amount: number) {
  const changed = await tx.$executeRaw`
    UPDATE "wallets"
    SET "reserved_balance" = "reserved_balance" - ${amount},
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "user_id" = ${userId}
      AND "reserved_balance" >= ${amount}
  `
  if (changed !== 1) throw new Error('Payout reservation is missing.')
}

export async function finalizePayoutFunds(tx: PayoutTx, userId: string, amount: number) {
  const changed = await tx.$executeRaw`
    UPDATE "wallets"
    SET "balance" = "balance" - ${amount},
        "reserved_balance" = "reserved_balance" - ${amount},
        "total_withdrawn" = "total_withdrawn" + ${amount},
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "user_id" = ${userId}
      AND "balance" >= ${amount}
      AND "reserved_balance" >= ${amount}
  `
  if (changed !== 1) throw new Error('Reserved payout funds cannot be finalized.')
}
