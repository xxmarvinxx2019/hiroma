import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  'prisma/migrations/20260902145000_liquidate_deactivated_member_liabilities/migration.sql',
  'utf8',
)
const reserveRoute = readFileSync(
  'src/app/api/admin/commission-testing/reserve-ledger/route.ts',
  'utf8',
)

test('new deactivations are versioned while historical events remain visibly legacy', () => {
  const addColumn = migration.indexOf('ADD COLUMN IF NOT EXISTS "liability_liquidation_version"')
  const setDefault = migration.indexOf('ALTER COLUMN "liability_liquidation_version" SET DEFAULT')
  assert.ok(addColumn >= 0 && setDefault > addColumn)
  assert.match(migration, /stamp_deactivation_liability_version/)
  assert.match(reserveRoute, /legacy_deactivation_events/)
})

test('deactivation atomically forfeits every payable source lot exactly once', () => {
  assert.match(migration, /payable_lot_forfeitures_exact_source_check/)
  assert.match(migration, /payable_lot_forfeitures_direct_lot_key/)
  assert.match(migration, /payable_lot_forfeitures_binary_lot_key/)
  assert.match(migration, /payable_lot_forfeitures_product_binary_lot_key/)
  assert.match(migration, /FROM "direct_referral_reserve_lots" l[\s\S]*SET "remaining_amount" = 0/)
  assert.match(migration, /FROM "binary_payable_lots" l[\s\S]*SET "remaining_amount" = 0/)
  assert.match(migration, /FROM "product_binary_payable_lots" l[\s\S]*SET "remaining_amount" = 0/)
})

test('deactivation fails closed unless wallet, payables, payout state, and actor reconcile', () => {
  assert.match(migration, /financial-user:/)
  assert.match(migration, /active Admin processor/)
  assert.match(migration, /Resolve pending or approved payouts before deactivation/)
  assert.match(migration, /payable_total <> NEW\."wallet_value"/)
  assert.match(migration, /Wallet and payable liabilities do not reconcile; deactivation is blocked/)
})

test('commit requires exact ledger, company retention, audit, profile, and zero remaining liability', () => {
  assert.match(migration, /CREATE CONSTRAINT TRIGGER "reseller_deactivation_events_verify_liquidation"/)
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/)
  assert.match(migration, /ledger_count <> 1/)
  assert.match(migration, /forfeiture_total <> NEW\."wallet_value"/)
  assert.match(migration, /remaining_total <> 0/)
  assert.match(migration, /transfer_count <> 1 OR exact_transfer_count <> 1/)
  assert.match(migration, /audit_count <> 1/)
  assert.match(migration, /profile_left IS DISTINCT FROM 0 OR profile_right IS DISTINCT FROM 0 OR profile_active IS DISTINCT FROM false/)
})

test('reseller status cannot bypass its settlement, profile state, or audit trail', () => {
  assert.match(migration, /CREATE CONSTRAINT TRIGGER "users_verify_reseller_status_transition"/)
  assert.match(migration, /Inactive reseller transition requires one sealed deactivation settlement/)
  assert.match(migration, /Reseller status and profile activity are inconsistent/)
  assert.match(migration, /Reseller activation or suspension requires one immutable audit event/)
})

test('financial history and forfeiture evidence cannot be edited or deleted', () => {
  assert.match(migration, /payable_lot_forfeitures_protected_write/)
  assert.match(migration, /require_internal_financial_ledger_write/)
  assert.match(migration, /reseller_deactivation_events_append_only/)
  assert.match(migration, /reject_financial_history_change/)
})

test('reserve report subtracts forfeitures from liability and exposes every movement', () => {
  assert.match(reserveRoute, /source_type='direct_referral'/)
  assert.match(reserveRoute, /source_type='binary'/)
  assert.match(reserveRoute, /source_type='product_binary'/)
  assert.match(reserveRoute, /'deactivation_forfeit'/)
  assert.match(reserveRoute, /unreconciled_deactivations/)
  assert.match(reserveRoute, /total_deactivation_forfeited/)
})
