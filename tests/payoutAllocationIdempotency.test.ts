import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../prisma/migrations/20260813130000_make_binary_payout_allocation_idempotent/migration.sql', import.meta.url),
  'utf8',
)
const hardeningMigration = readFileSync(
  new URL('../prisma/migrations/20260902120000_harden_binary_settlement_and_payouts/migration.sql', import.meta.url),
  'utf8',
)

test('binary and product-binary allocators serialize the exact payout', () => {
  const locks = migration.match(/pg_advisory_xact_lock\(hashtextextended\(target_payout_id, 0\)\)/g) ?? []
  assert.equal(locks.length, 2)
})

test('allocators serialize all payable lots for the same member instead of skipping locked funds', () => {
  const memberLocks = migration.match(/pg_advisory_xact_lock\(hashtextextended\(target_user_id, 0\)\)/g) ?? []
  assert.equal(memberLocks.length, 2)
  assert.doesNotMatch(migration, /SKIP LOCKED/)
})

test('allocators skip lots already consumed by the same payout', () => {
  assert.match(migration, /NOT EXISTS \([\s\S]*?binary_payout_consumptions[\s\S]*?c\."payout_id" = target_payout_id[\s\S]*?c\."payable_lot_id" = l\."id"/)
  assert.match(migration, /NOT EXISTS \([\s\S]*?product_binary_payout_consumptions[\s\S]*?c\.payout_id = target_payout_id[\s\S]*?c\.payable_lot_id = l\.id/)
})

test('consumption evidence is inserted before its payable lot is reduced', () => {
  const binaryInsert = migration.indexOf('INSERT INTO "binary_payout_consumptions"')
  const binaryUpdate = migration.indexOf('UPDATE "binary_payable_lots"', binaryInsert)
  const productInsert = migration.indexOf('INSERT INTO product_binary_payout_consumptions')
  const productUpdate = migration.indexOf('UPDATE product_binary_payable_lots', productInsert)

  assert.ok(binaryInsert >= 0 && binaryInsert < binaryUpdate)
  assert.ok(productInsert >= 0 && productInsert < productUpdate)
  assert.doesNotMatch(migration, /ON CONFLICT[\s\S]{0,120}DO NOTHING/)
})

test('existing payout amount, FIFO ordering, and allocation timestamp semantics remain unchanged', () => {
  assert.match(migration, /GREATEST\(payout_amount - direct_used - binary_used, 0\)/)
  assert.match(migration, /GREATEST\(payout_amount - used, 0\)/)
  assert.match(migration, /ORDER BY l\."allocated_at" ASC, l\."id" ASC/)
  assert.match(migration, /ORDER BY l\.allocated_at, l\.id/)
  assert.match(migration, /LEAST\(remaining, lot\."remaining_amount"\)/)
  assert.match(migration, /LEAST\(remaining, lot\.remaining_amount\)/)
  assert.match(migration, /VALUES \(target_payout_id, lot\."id", consumed, allocation_time\)/)
  assert.match(migration, /VALUES\(target_payout_id, lot\.id, consumed, allocation_time\)/)
})

test('approved payouts fail closed unless every peso has a payable source allocation', () => {
  assert.match(
    hardeningMigration,
    /direct_referral_payout_consumptions[\s\S]*binary_payout_consumptions[\s\S]*product_binary_payout_consumptions/,
  )
  assert.match(
    hardeningMigration,
    /IF allocated <> NEW\."amount" THEN[\s\S]*RAISE EXCEPTION/,
  )
  assert.match(
    hardeningMigration,
    /CREATE TRIGGER "zzzz_payouts_require_full_source_allocation"/,
  )
  assert.match(
    hardeningMigration,
    /NEW\."status" IN \('approved', 'released'\)/,
  )
  assert.match(
    hardeningMigration,
    /Historical payouts require full source-allocation reconciliation/,
  )
})

test('admin payout approval exposes a ledger reconciliation conflict instead of a false success', () => {
  const route = readFileSync('src/app/api/admin/payouts/route.ts', 'utf8')
  assert.match(route, /isPayoutSourceAllocationError/)
  assert.match(route, /Payout cannot be approved because its spendable commission sources are not fully allocated/)
  assert.match(route, /status: 409/)
})
