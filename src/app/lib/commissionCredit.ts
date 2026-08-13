import { randomUUID } from 'node:crypto'
import type { CommissionType, Prisma } from '@prisma/client'

type CommissionTx = Prisma.TransactionClient

type CreditInput = {
  eventKey: string
  userId: string
  type: CommissionType
  amount: number
  points?: number | null
  sourceUserId?: string | null
  isOverflow?: boolean
  overflowTo?: string | null
}

export async function creditCommissionExactlyOnce(tx: CommissionTx, input: CreditInput) {
  if (!input.eventKey || input.eventKey.length > 255) throw new Error('Invalid commission event key.')
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Commission credit must be positive.')

  const commissionId = randomUUID()
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "commissions" (
      "id", "event_key", "user_id", "type", "amount", "points",
      "source_user_id", "is_pair_overflow", "overflow_to", "created_at"
    ) VALUES (
      ${commissionId}, ${input.eventKey}, ${input.userId}, ${input.type}::"CommissionType", ${input.amount},
      ${input.points ?? null}, ${input.sourceUserId ?? null}, ${input.isOverflow ?? false},
      ${input.overflowTo ?? null}, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("event_key") DO NOTHING
    RETURNING "id"::text
  `

  if (inserted.length === 0) {
    const existing = await tx.commission.findUnique({
      where: { event_key: input.eventKey },
      select: { id: true, user_id: true, type: true, amount: true },
    })
    if (!existing) throw new Error('Commission idempotency state is inconsistent.')
    if (
      existing.user_id !== input.userId ||
      existing.type !== input.type ||
      Number(existing.amount) !== input.amount
    ) throw new Error('Commission event key was reused with conflicting financial details.')
    return { id: existing.id, credited: false as const }
  }

  await tx.wallet.upsert({
    where: { user_id: input.userId },
    update: { balance: { increment: input.amount }, total_earned: { increment: input.amount } },
    create: { user_id: input.userId, balance: input.amount, total_earned: input.amount, total_withdrawn: 0 },
  })
  return { id: inserted[0].id, credited: true as const }
}
