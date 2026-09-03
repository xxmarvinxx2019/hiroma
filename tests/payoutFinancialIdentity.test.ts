import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const payoutIdentityMigration = readFileSync(
  new URL('../prisma/migrations/20260902130000_harden_payout_identity_and_status_transitions/migration.sql', import.meta.url),
  'utf8',
)

test('payouts are created pending and cannot mutate recipient or amount afterward', () => {
  assert.match(
    payoutIdentityMigration,
    /NEW\."status" <> 'pending'[\s\S]*Payouts must be created in pending status\./,
  )
  assert.match(
    payoutIdentityMigration,
    /NEW\."user_id" IS DISTINCT FROM OLD\."user_id"[\s\S]*Payout recipient is immutable after creation\./,
  )
  assert.match(
    payoutIdentityMigration,
    /NEW\."amount" IS DISTINCT FROM OLD\."amount"[\s\S]*Payout amount is immutable after creation\./,
  )
})

test('payout status transitions are monotonic and limited to the approved release flow', () => {
  assert.match(
    payoutIdentityMigration,
    /OLD\."status" = 'pending' AND NEW\."status" IN \('approved', 'rejected'\)/,
  )
  assert.match(
    payoutIdentityMigration,
    /OLD\."status" = 'approved' AND NEW\."status" = 'released'/,
  )
  assert.match(
    payoutIdentityMigration,
    /Illegal payout status transition\./,
  )
})

test('full-source payout verification reruns for financial identity changes as well as status changes', () => {
  assert.match(
    payoutIdentityMigration,
    /CREATE TRIGGER "zzzz_payouts_require_full_source_allocation"[\s\S]*AFTER INSERT OR UPDATE OF "status", "user_id", "amount" ON "payouts"/,
  )
})
