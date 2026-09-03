import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'

type WalletTx = Prisma.TransactionClient

export type WalletLedgerEntryType =
  | 'payout_reservation'
  | 'payout_reservation_release'
  | 'payout_disbursement'
  | 'deactivation_forfeit'

type WalletLedgerInput = {
  eventKey: string
  userId: string
  entryType: WalletLedgerEntryType
  balanceDelta?: number
  reservedDelta?: number
  totalEarnedDelta?: number
  totalWithdrawnDelta?: number
  payoutId?: string | null
  sourceKind: string
  sourceEventId: string
  metadata?: Record<string, unknown>
}

type ExistingLedgerRow = {
  user_id: string
  entry_type: string
  balance_delta: string | number
  reserved_delta: string | number
  total_earned_delta: string | number
  total_withdrawn_delta: string | number
  payout_id: string | null
  source_kind: string
  source_event_id: string
}

function cents(value: unknown) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) throw new Error('Wallet ledger amount is invalid.')
  return Math.round(amount * 100)
}

export async function lockFinancialUser(tx: WalletTx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'financial-user:' + userId}))`
}

export async function appendWalletLedgerEntryExactlyOnce(
  tx: WalletTx,
  input: WalletLedgerInput,
) {
  if (!input.eventKey || input.eventKey.length > 255) throw new Error('Invalid wallet ledger event key.')
  if (!input.sourceEventId || input.sourceEventId.length > 255) throw new Error('Invalid wallet ledger source event.')

  const deltas = {
    balance: input.balanceDelta ?? 0,
    reserved: input.reservedDelta ?? 0,
    earned: input.totalEarnedDelta ?? 0,
    withdrawn: input.totalWithdrawnDelta ?? 0,
  }
  Object.values(deltas).forEach(cents)

  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "wallet_ledger_entries" (
      "id", "event_key", "user_id", "entry_type", "balance_delta",
      "reserved_delta", "total_earned_delta", "total_withdrawn_delta",
      "payout_id", "source_kind", "source_event_id", "metadata", "created_at"
    ) VALUES (
      ${randomUUID()}::uuid, ${input.eventKey}, ${input.userId}, ${input.entryType},
      ${deltas.balance}, ${deltas.reserved}, ${deltas.earned}, ${deltas.withdrawn},
      ${input.payoutId ?? null}, ${input.sourceKind}, ${input.sourceEventId},
      ${JSON.stringify(input.metadata ?? {})}::jsonb, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("event_key") DO NOTHING
    RETURNING "id"::text
  `
  if (inserted.length) return { id: inserted[0].id, inserted: true as const }

  const rows = await tx.$queryRaw<ExistingLedgerRow[]>`
    SELECT "user_id", "entry_type", "balance_delta"::text, "reserved_delta"::text,
      "total_earned_delta"::text, "total_withdrawn_delta"::text,
      "payout_id"::text, "source_kind", "source_event_id"
    FROM "wallet_ledger_entries"
    WHERE "event_key" = ${input.eventKey}
    LIMIT 1
  `
  const row = rows[0]
  if (!row
    || row.user_id !== input.userId
    || row.entry_type !== input.entryType
    || cents(row.balance_delta) !== cents(deltas.balance)
    || cents(row.reserved_delta) !== cents(deltas.reserved)
    || cents(row.total_earned_delta) !== cents(deltas.earned)
    || cents(row.total_withdrawn_delta) !== cents(deltas.withdrawn)
    || row.payout_id !== (input.payoutId ?? null)
    || row.source_kind !== input.sourceKind
    || row.source_event_id !== input.sourceEventId) {
    throw new Error('Wallet ledger event key was reused with conflicting financial details.')
  }
  return { id: input.eventKey, inserted: false as const }
}
