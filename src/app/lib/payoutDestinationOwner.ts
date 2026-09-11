import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'

export class PayoutDestinationOwnershipError extends Error {
  constructor(message = 'This payout destination is already registered to another verified person.') {
    super(message)
    this.name = 'PayoutDestinationOwnershipError'
  }
}

export function payoutDestinationHash(type: string, bankName: string | null | undefined, accountNumber: string) {
  const normalized = `${type.trim().toLowerCase()}|${(bankName || '').trim().toLowerCase()}|${accountNumber.replace(/[^a-z0-9]/gi, '').toUpperCase()}`
  return createHash('sha256').update(normalized).digest('hex')
}

export async function claimPayoutDestinationOwner(tx: Prisma.TransactionClient, input: { type: string; bankName?: string | null; accountNumber: string; identityHash: string; userId: string }) {
  const destinationHash = payoutDestinationHash(input.type, input.bankName, input.accountNumber)
  const changed = await tx.$executeRaw`
    INSERT INTO "payout_destination_owners" ("destination_hash", "identity_hash", "first_registered_by", "created_at", "updated_at")
    VALUES (${destinationHash}, ${input.identityHash}, ${input.userId}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("destination_hash") DO UPDATE SET "updated_at" = CURRENT_TIMESTAMP
    WHERE "payout_destination_owners"."identity_hash" = EXCLUDED."identity_hash"
  `
  if (changed !== 1) throw new PayoutDestinationOwnershipError()
}
