import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  'prisma/migrations/20260902140000_add_financial_ledger_boundary/migration.sql',
  'utf8',
)

test('migration stops for historical duplicate direct payments before enforcing uniqueness', () => {
  const preflight = migration.indexOf('Duplicate paid registration direct-referral events require reconciliation')
  const uniqueBoundary = migration.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS "commissions_one_paid_direct_per_registration"')
  assert.ok(preflight >= 0 && preflight < uniqueBoundary)
  assert.match(migration, /GROUP BY "source_event_id"[\s\S]*HAVING COUNT\(\*\) > 1/)
})

test('wallet ledger validates immutable financial sources before applying any balance delta', () => {
  const validator = migration.indexOf('CREATE OR REPLACE FUNCTION "apply_wallet_ledger_entry"')
  const mutation = migration.indexOf('UPDATE "wallets"', validator)
  assert.ok(validator >= 0 && mutation > validator)
  assert.match(migration, /Commission wallet credit does not match an active reseller commission/)
  assert.match(migration, /Package Binary commission is not fully funded/)
  assert.match(migration, /Product Binary commission is not fully funded/)
  assert.match(migration, /Payout reservation exceeds source-backed withdrawable funds/)
  assert.match(migration, /Wallet ledger delta violates wallet balance invariants/)
})

test('every legacy commission is identity-bound before wallet deltas can be applied', () => {
  const commissionIdentityUnique = migration.indexOf(
    'CONSTRAINT "wallet_ledger_entries_commission_id_key" UNIQUE ("commission_id")',
  )
  const walletOpening = migration.indexOf("'legacy-wallet-opening:'")
  const legacyMarker = migration.indexOf("'legacy_commission_component'")
  const applyFunction = migration.indexOf('CREATE OR REPLACE FUNCTION "apply_wallet_ledger_entry"')
  const applyTrigger = migration.indexOf('CREATE TRIGGER "wallet_ledger_entries_apply"')

  assert.ok(commissionIdentityUnique >= 0 && commissionIdentityUnique < walletOpening)
  assert.ok(walletOpening < legacyMarker)
  assert.ok(legacyMarker < applyFunction && applyFunction < applyTrigger)
  assert.match(
    migration,
    /legacy-commission-component:' \|\| c\."id"[\s\S]*'legacy_commission_component'[\s\S]*\n\s*0,[\s\S]*\n\s*0,[\s\S]*\n\s*0,[\s\S]*\n\s*0,[\s\S]*c\."id",[\s\S]*'zero_delta_replay_blocker', true/,
  )
  assert.match(migration, /FROM "commissions" c\s+ON CONFLICT \("commission_id"\) DO NOTHING/)
  assert.match(
    migration,
    /LEFT JOIN "wallet_ledger_entries" entry ON entry\."commission_id" = c\."id"[\s\S]*Every legacy commission must have an immutable wallet-ledger identity marker/,
  )
  assert.match(
    migration,
    /FOREACH table_name IN ARRAY ARRAY\[[\s\S]*'wallet_ledger_entries'[\s\S]*CREATE TRIGGER %I BEFORE UPDATE OR DELETE/,
  )
})

test('wallets and source allocation tables reject direct mutation', () => {
  assert.match(migration, /Wallets cannot be deleted; use the immutable ledger/)
  assert.match(migration, /Wallet balances may only be changed by the immutable ledger/)
  assert.match(migration, /require_internal_financial_ledger_write/)
  assert.match(migration, /binary_reserve_lots/)
  assert.match(migration, /direct_referral_reserve_lots/)
  assert.match(migration, /product_binary_funding_lots/)
})

test('payout release and disbursement require their own prior reservation lineage', () => {
  assert.match(
    migration,
    /entry_type" = 'payout_reservation_release'[\s\S]*reservation_exists = false/,
  )
  assert.match(
    migration,
    /entry_type" = 'payout_reservation'[\s\S]*entry_type" = 'payout_reservation_release'/,
  )
  assert.match(migration, /reservation_exists = false OR reservation_release_exists = true/)
})

test('registration and upgrade snapshots create only their explicit binary reserve allocation', () => {
  assert.match(
    migration,
    /create_binary_reserve_lot_for_upgrade[\s\S]*NEW\."binary_commission_allocation", NEW\."binary_commission_allocation"/,
  )
  assert.doesNotMatch(
    migration,
    /create_binary_reserve_lot_for_upgrade[\s\S]{0,800}NEW\."direct_referral_retained"\s*\+/,
  )
})

test('a PIN allocation is serialized and cannot reuse a commerce order as funding', () => {
  const pinMigration = readFileSync(
    'prisma/migrations/20260902141000_snapshot_registration_pin_economics/migration.sql',
    'utf8',
  )
  assert.match(pinMigration, /financial_purpose" = 'pin_sale'/)
  assert.match(pinMigration, /funding_order_id" FOR UPDATE/)
  assert.match(pinMigration, /funding_pin_request_id" FOR UPDATE/)
  assert.match(pinMigration, /NOT EXISTS \(SELECT 1 FROM "order_items"/)
  assert.match(pinMigration, /NOT EXISTS \(SELECT 1 FROM "pos_transactions"/)
  assert.match(pinMigration, /dedicated PIN-sale funding order cannot contain product or POS commerce/)
  assert.match(pinMigration, /Order financial purpose is immutable\./)
  assert.match(
    pinMigration,
    /OLD\."financial_purpose" = 'pin_sale'[\s\S]*A PIN funding order is immutable after issuance\./,
  )
})

test('legacy UUID identity columns are normalized to the schema TEXT boundary', () => {
  const pinMigration = readFileSync(
    'prisma/migrations/20260902141000_snapshot_registration_pin_economics/migration.sql',
    'utf8',
  )
  assert.match(pinMigration, /ALTER COLUMN "upgrade_from_package_id" TYPE TEXT/)
  assert.match(pinMigration, /ALTER COLUMN "upgrade_pin_id" TYPE TEXT/)
  assert.match(pinMigration, /ALTER COLUMN "to_package_id" TYPE TEXT/)
})
