import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migrationPaths = [
  'prisma/migrations/20260901174000_enforce_reseller_only_payouts/migration.sql',
  'prisma/migrations/20260902120000_harden_binary_settlement_and_payouts/migration.sql',
  'prisma/migrations/20260902130000_harden_payout_identity_and_status_transitions/migration.sql',
  'prisma/migrations/20260902140000_add_financial_ledger_boundary/migration.sql',
  'prisma/migrations/20260902141000_snapshot_registration_pin_economics/migration.sql',
  'prisma/migrations/20260902142000_seal_upgrade_pin_economics/migration.sql',
  'prisma/migrations/20260902144000_enforce_complete_payout_lifecycle/migration.sql',
  'prisma/migrations/20260902145000_liquidate_deactivated_member_liabilities/migration.sql',
  'prisma/migrations/20260902146000_seal_binary_tree_placements/migration.sql',
  'prisma/migrations/20260902154000_enforce_payout_audit_evidence/migration.sql',
  'prisma/migrations/20260902155000_bind_upgrade_binary_reserve_lots/migration.sql',
] as const

const orderedLockMigrationPaths = [
  'prisma/migrations/20260901170000_enforce_funded_binary_commissions/migration.sql',
  'prisma/migrations/20260901173000_enforce_funded_product_binary_commissions/migration.sql',
  'prisma/migrations/20260901174000_enforce_reseller_only_payouts/migration.sql',
  'prisma/migrations/20260902120000_harden_binary_settlement_and_payouts/migration.sql',
  'prisma/migrations/20260902130000_harden_payout_identity_and_status_transitions/migration.sql',
  'prisma/migrations/20260902140000_add_financial_ledger_boundary/migration.sql',
  'prisma/migrations/20260902141000_snapshot_registration_pin_economics/migration.sql',
  'prisma/migrations/20260902142000_seal_upgrade_pin_economics/migration.sql',
  'prisma/migrations/20260902143000_enforce_exact_commission_entitlement/migration.sql',
  'prisma/migrations/20260902144000_enforce_complete_payout_lifecycle/migration.sql',
  'prisma/migrations/20260902145000_liquidate_deactivated_member_liabilities/migration.sql',
  'prisma/migrations/20260902146000_seal_binary_tree_placements/migration.sql',
  'prisma/migrations/20260902147000_atomic_binary_tree_descendant_counts/migration.sql',
  'prisma/migrations/20260902148000_seal_deactivation_evidence_timestamps/migration.sql',
  'prisma/migrations/20260902149000_seal_direct_referral_settlements/migration.sql',
  'prisma/migrations/20260902150000_enforce_upgrade_path_ordering/migration.sql',
  'prisma/migrations/20260902151000_add_member_id_issuance_registry/migration.sql',
  'prisma/migrations/20260902152000_bind_product_binary_to_paid_orders/migration.sql',
  'prisma/migrations/20260902153000_harden_financial_trigger_execution/migration.sql',
  'prisma/migrations/20260902154000_enforce_payout_audit_evidence/migration.sql',
  'prisma/migrations/20260902155000_bind_upgrade_binary_reserve_lots/migration.sql',
] as const

const read = (path: string) => readFileSync(path, 'utf8')

test('scoped financial cutovers are one PostgreSQL transaction with a tested-version gate and write lock', () => {
  for (const path of migrationPaths) {
    const migration = read(path)
    const begin = migration.indexOf('BEGIN;')
    const versionGate = migration.indexOf("current_setting('server_version_num')::INTEGER < 150000")
    const lock = migration.indexOf('LOCK TABLE')
    const firstMutationCandidates = [
      migration.indexOf('ALTER TABLE'),
      migration.indexOf('CREATE TABLE'),
      migration.indexOf('CREATE OR REPLACE FUNCTION'),
      migration.indexOf('UPDATE '),
      migration.indexOf('INSERT INTO'),
    ].filter((position) => position >= 0)
    const firstMutation = Math.min(...firstMutationCandidates)

    assert.equal((migration.match(/^BEGIN;$/gm) ?? []).length, 1, `${path} must have exactly one BEGIN`)
    assert.equal((migration.match(/^COMMIT;$/gm) ?? []).length, 1, `${path} must have exactly one COMMIT`)
    assert.equal((migration.match(/^LOCK TABLE/gm) ?? []).length, 1, `${path} must have exactly one lock boundary`)
    assert.equal(
      (migration.match(/server_version_num'\)::INTEGER < 150000/g) ?? []).length,
      1,
      `${path} must have exactly one PostgreSQL 15 version gate`,
    )
    assert.ok(begin >= 0, `${path} must begin an explicit transaction`)
    assert.ok(versionGate > begin, `${path} must gate unsupported PostgreSQL versions`)
    assert.ok(lock > versionGate, `${path} must lock after the version gate`)
    assert.ok(lock < firstMutation, `${path} must lock before its first schema/data mutation`)
    assert.match(migration.slice(lock, firstMutation), /IN SHARE ROW EXCLUSIVE MODE;/)
    assert.match(migration, /COMMIT;\s*$/)
    assert.doesNotMatch(migration, /CONCURRENTLY/i)
  }
})

test('financial cutovers acquire table locks in one deterministic alphabetical order', () => {
  for (const path of orderedLockMigrationPaths) {
    const migration = read(path)
    const lockMatch = migration.match(
      /LOCK TABLE\s+([\s\S]*?)\s+IN SHARE ROW EXCLUSIVE MODE;/,
    )

    assert.ok(lockMatch, `${path} must declare a SHARE ROW EXCLUSIVE lock boundary`)
    const tables = [...lockMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
    const sortedTables = [...tables].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    )

    assert.deepEqual(tables, sortedTables, `${path} must use the shared alphabetical lock order`)
  }
})

test('wallet opening, legacy commission identities, and payout reservations are proved while writes are locked', () => {
  const migration = read(migrationPaths[3])
  const lock = migration.indexOf('LOCK TABLE')
  const proof = migration.indexOf('Wallet reservations do not exactly prove the open payout set.')
  const walletOpening = migration.indexOf("'legacy-wallet-opening:'")
  const payoutReservation = migration.indexOf("'payout-reservation:'")
  const legacyCommissionMarker = migration.indexOf("'legacy_commission_component'")
  const walletTrigger = migration.indexOf('CREATE TRIGGER "wallet_ledger_entries_apply"')
  const walletGuard = migration.indexOf('CREATE TRIGGER "wallets_protect_balances"')
  const commit = migration.lastIndexOf('COMMIT;')

  assert.ok(lock < proof)
  assert.ok(proof < walletOpening)
  assert.ok(walletOpening < payoutReservation)
  assert.ok(payoutReservation < legacyCommissionMarker)
  assert.ok(legacyCommissionMarker < walletTrigger)
  assert.ok(walletTrigger < walletGuard)
  assert.ok(walletGuard < commit)
  assert.match(migration, /"reserved_balance" <> expected_reserved/)
  assert.match(migration, /do not fabricate per-payout evidence/)
  for (const protectedSource of [
    '"inventory_movements"',
    '"product_binary_funding_consumptions"',
    '"product_binary_funding_lots"',
    '"product_binary_order_events"',
    '"product_binary_pair_events"',
  ]) {
    assert.ok(
      migration.slice(lock, proof).includes(protectedSource),
      `wallet cutover must freeze ${protectedSource}`,
    )
  }
  assert.match(migration, /NEW\."source_kind" <> 'payout'/)
  assert.match(migration, /NEW\."source_event_id" <> NEW\."payout_id"/)
  assert.match(migration, /NEW\."created_at" := transaction_timestamp\(\)/)
})

test('a cutover lock never names the table that the same migration creates afterward', () => {
  const migration = read(migrationPaths[1])
  const lockBoundary = migration.slice(
    migration.indexOf('LOCK TABLE'),
    migration.indexOf('IN SHARE ROW EXCLUSIVE MODE;'),
  )
  assert.doesNotMatch(lockBoundary, /"binary_settlement_events"/)
  assert.ok(
    migration.indexOf('CREATE TABLE "binary_settlement_events"') >
      migration.indexOf('IN SHARE ROW EXCLUSIVE MODE;'),
  )
})

test('registration and upgrade cutovers list every unresolved authoritative PIN source', () => {
  const registration = read(migrationPaths[4])
  const upgrade = read(migrationPaths[5])

  assert.match(registration, /Authoritative registration PIN snapshots are required before cutover\./)
  assert.match(registration, /unresolved_unused_registration_pins=%s first_pin_ids=%s/)
  assert.match(registration, /unresolved_pending_pin_requests=%s first_request_ids=%s/)
  assert.match(registration, /NOT "registration_snapshot_is_valid"/)
  assert.match(registration, /NOT "pin_has_exact_paid_source"/)
  assert.match(registration, /Never infer history from current package prices\./)

  assert.match(upgrade, /Authoritative Upgrade PIN snapshots are required before cutover\./)
  assert.match(upgrade, /unresolved_unused_upgrade_pins=%s first_pin_ids=%s/)
  assert.match(upgrade, /NOT "upgrade_pin_snapshot_is_exact"/)
  assert.match(upgrade, /NOT "pin_has_exact_paid_source"/)
  assert.match(upgrade, /Never infer history from current upgrade configuration\./)
})

test('legacy payouts require exact lifecycle, ledger, recipient, reviewer, and allocation proof', () => {
  const migration = read(migrationPaths[6])

  assert.match(migration, /Existing payout lifecycle rows lack exact authoritative ledger evidence\./)
  assert.match(migration, /unresolved_payouts=%s first_payout_ids=%s/)
  assert.match(migration, /e\.recipient_role IS DISTINCT FROM 'reseller'/)
  assert.match(migration, /e\.reservation_count <> 1 OR e\.reservation_amount <> e\."amount"/)
  assert.match(migration, /e\.release_count <> 1 OR e\.release_amount <> -e\."amount"/)
  assert.match(migration, /e\.disbursement_count <> 1/)
  assert.match(migration, /e\.allocated_amount <> e\."amount"/)
  assert.match(migration, /Never create reservation, release, allocation, or disbursement history from status alone\./)
})

test('upgrade-funded binary reserve lots require an authoritative upgrade foreign key', () => {
  const migration = read(
    'prisma/migrations/20260902155000_bind_upgrade_binary_reserve_lots/migration.sql',
  )
  const preflight = migration.indexOf(
    'Upgrade-funded binary reserve lots reference no authoritative upgrade.',
  )
  const addConstraint = migration.indexOf(
    'ADD CONSTRAINT "binary_reserve_lots_upgrade_financial_id_fkey"',
  )
  const validateConstraint = migration.indexOf(
    'VALIDATE CONSTRAINT "binary_reserve_lots_upgrade_financial_id_fkey"',
  )

  assert.ok(preflight >= 0)
  assert.ok(preflight < addConstraint)
  assert.ok(addConstraint < validateConstraint)
  assert.match(migration, /unresolved_reserve_lots=%s first_reserve_lot_ids=%s/)
  assert.match(
    migration,
    /FOREIGN KEY \("upgrade_financial_id"\)[\s\S]*REFERENCES "upgrade_financials"\("id"\)[\s\S]*ON DELETE RESTRICT[\s\S]*ON UPDATE CASCADE[\s\S]*NOT VALID;/,
  )
  assert.match(migration, /Never delete, rewrite, or fabricate this lineage\./)
})
