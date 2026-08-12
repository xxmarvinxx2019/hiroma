import type { Prisma } from '@prisma/client'

type IdentityTx = Prisma.TransactionClient

export class IdentityAccountLimitError extends Error {
  constructor() {
    super('Maximum accounts (7) reached for this verified identity.')
    this.name = 'IdentityAccountLimitError'
  }
}

export async function claimIdentityAccountSlot(tx: IdentityTx, identityHash: string) {
  const changed = await tx.$executeRaw`
    INSERT INTO "identity_account_limits" ("identity_hash", "count", "max_allowed", "updated_at")
    VALUES (${identityHash}, 1, 7, CURRENT_TIMESTAMP)
    ON CONFLICT ("identity_hash") DO UPDATE
    SET "count" = "identity_account_limits"."count" + 1,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "identity_account_limits"."count" < "identity_account_limits"."max_allowed"
  `
  if (changed !== 1) throw new IdentityAccountLimitError()
}

export async function releaseIdentityAccountSlot(tx: IdentityTx, identityHash: string) {
  const changed = await tx.$executeRaw`
    UPDATE "identity_account_limits"
    SET "count" = "count" - 1,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "identity_hash" = ${identityHash}
      AND "count" > 0
  `
  if (changed !== 1) throw new Error('Verified identity account counter is inconsistent.')
}
