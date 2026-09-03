import { randomUUID } from 'node:crypto'
import type { CommissionType, Prisma } from '@prisma/client'

type CommissionTx = Prisma.TransactionClient

type CreditInput = {
  eventKey: string
  sourceEventKind: 'registration' | 'upgrade' | 'product_order' | 'deactivation'
  sourceEventId: string
  ruleVersion: string
  userId: string
  type: CommissionType
  amount: number
  points?: number | null
  sourceUserId?: string | null
  isOverflow?: boolean
  overflowTo?: string | null
}

type BinaryFundingRow = {
  funded_amount: string | number | null
  unfunded_amount: string | number | null
}

type WalletCreditRow = {
  id: string
  balance_delta: string | number
  total_earned_delta: string | number
}

function toCentavos(value: unknown) {
  const amount = Number(value)
  if (!Number.isFinite(amount))
    throw new Error('Commission financial state is invalid.')
  return Math.round(amount * 100)
}

async function insertCommissionExactlyOnce(tx: CommissionTx, input: CreditInput) {
  if (!input.eventKey || input.eventKey.length > 255) throw new Error('Invalid commission event key.')
  if (!input.sourceEventId || input.sourceEventId.length > 255) throw new Error('Invalid commission source event.')
  if (!input.ruleVersion || input.ruleVersion.length > 64) throw new Error('Invalid commission rule version.')
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('Commission amount must be positive.')

  const commissionId = randomUUID()
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "commissions" (
      "id", "event_key", "source_event_kind", "source_event_id", "rule_version",
      "user_id", "type", "amount", "points",
      "source_user_id", "is_pair_overflow", "overflow_to", "created_at"
    ) VALUES (
      ${commissionId}, ${input.eventKey}, ${input.sourceEventKind}, ${input.sourceEventId}, ${input.ruleVersion},
      ${input.userId}, ${input.type}::"CommissionType", ${input.amount},
      ${input.points ?? null}, ${input.sourceUserId ?? null}, ${input.isOverflow ?? false},
      ${input.overflowTo ?? null}, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("event_key") DO NOTHING
    RETURNING "id"::text
  `

  if (inserted.length > 0) return { id: inserted[0].id, inserted: true as const }

  const existing = await tx.commission.findUnique({
    where: { event_key: input.eventKey },
    select: {
      id: true,
      source_event_kind: true,
      source_event_id: true,
      rule_version: true,
      user_id: true,
      type: true,
      amount: true,
      points: true,
      source_user_id: true,
      is_pair_overflow: true,
      overflow_to: true,
    },
  })
  if (!existing) throw new Error('Commission idempotency state is inconsistent.')
  if (
    existing.user_id !== input.userId ||
    existing.source_event_kind !== input.sourceEventKind ||
    existing.source_event_id !== input.sourceEventId ||
    existing.rule_version !== input.ruleVersion ||
    existing.type !== input.type ||
    toCentavos(existing.amount) !== toCentavos(input.amount) ||
    existing.points !== (input.points ?? null) ||
    existing.source_user_id !== (input.sourceUserId ?? null) ||
    existing.is_pair_overflow !== (input.isOverflow ?? false) ||
    existing.overflow_to !== (input.overflowTo ?? null)
  ) throw new Error('Commission event key was reused with conflicting financial details.')

  return { id: existing.id, inserted: false as const }
}

async function assertCommissionWalletCredit(
  tx: CommissionTx,
  commissionId: string,
  commissionAmount: number,
) {
  const rows = await tx.$queryRaw<WalletCreditRow[]>`
    SELECT "id"::text, "balance_delta"::text, "total_earned_delta"::text
    FROM "wallet_ledger_entries"
    WHERE "commission_id" = ${commissionId}
    LIMIT 1
  `
  const row = rows[0]
  if (!row || toCentavos(row.balance_delta) !== toCentavos(commissionAmount)
    || toCentavos(row.total_earned_delta) !== toCentavos(commissionAmount)) {
    throw new Error('Commission was not applied through the protected wallet ledger.')
  }
}

async function assertBinaryCommissionIsFullyFunded(
  tx: CommissionTx,
  commissionId: string,
  commissionAmount: number,
) {
  const [funding] = await tx.$queryRaw<BinaryFundingRow[]>`
    SELECT
      COALESCE(SUM("amount") FILTER (WHERE "is_unfunded" = false), 0)::text AS "funded_amount",
      COALESCE(SUM("amount") FILTER (WHERE "is_unfunded" = true), 0)::text AS "unfunded_amount"
    FROM "binary_reserve_consumptions"
    WHERE "commission_id" = ${commissionId}
  `
  const requiredCentavos = toCentavos(commissionAmount)
  const fundedCentavos = toCentavos(funding?.funded_amount ?? 0)
  const unfundedCentavos = toCentavos(funding?.unfunded_amount ?? 0)

  if (fundedCentavos !== requiredCentavos || unfundedCentavos !== 0)
    throw new Error('Binary commission is not fully funded by reserve.')
}

export async function creditCommissionExactlyOnce(tx: CommissionTx, input: CreditInput) {
  const commission = await insertCommissionExactlyOnce(tx, input)

  // The database trigger is the primary fail-closed boundary and consumes the
  // reserve in this transaction. Verify its result before making funds
  // withdrawable so a missing/outdated trigger cannot silently over-credit.
  if (input.type === 'binary_pairing')
    await assertBinaryCommissionIsFullyFunded(tx, commission.id, input.amount)

  // The final database commission trigger inserts exactly one source-validated
  // wallet ledger entry. A missing entry means the migration/trigger boundary
  // is absent or funding validation failed, so the whole source transaction
  // must roll back.
  await assertCommissionWalletCredit(tx, commission.id, input.amount)
  return { id: commission.id, credited: commission.inserted }
}

// Retained or flushed amounts remain immutable accounting evidence, but are
// deliberately not added to any spendable wallet.
export async function recordCommissionExactlyOnce(tx: CommissionTx, input: CreditInput) {
  if (!input.isOverflow) throw new Error('Record-only commissions must be retained/flashout evidence.')
  const commission = await insertCommissionExactlyOnce(tx, input)
  return { id: commission.id, recorded: commission.inserted }
}
