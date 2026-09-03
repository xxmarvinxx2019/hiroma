import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../prisma/migrations/20260902144000_enforce_complete_payout_lifecycle/migration.sql', import.meta.url),
  'utf8',
)
const adminRoute = readFileSync('src/app/api/admin/payouts/route.ts', 'utf8')
const releaseRoute = readFileSync('src/app/api/cron/release-payouts/route.ts', 'utf8')
const integrityRoute = readFileSync('src/app/api/admin/commission-testing/reserve-ledger/route.ts', 'utf8')
const integrityPage = readFileSync('src/app/dashboard/admin/commission-testing/reserve-ledger/page.tsx', 'utf8')

test('one member cannot create concurrent duplicate pending payouts', () => {
  assert.match(migration, /duplicate pending payouts require reconciliation/)
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS "payouts_one_pending_per_user"[\s\S]*WHERE "status" = 'pending'/,
  )
})

test('payout destination, schedule, reviewer, and transaction evidence are immutable', () => {
  assert.match(migration, /Payout destination and schedule are immutable after request\./)
  assert.match(migration, /Payout reviewer must be an active administrator\./)
  assert.match(migration, /An approved payout requires an immutable transaction number\./)
  assert.match(migration, /Payout processing evidence may change only during a legal status transition\./)
})

test('every payout status requires exact wallet-ledger and payable-lot evidence at commit', () => {
  assert.match(migration, /CREATE CONSTRAINT TRIGGER "payouts_require_complete_ledger_state"/)
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/)
  assert.match(migration, /Payout does not have exactly one matching wallet reservation\./)
  assert.match(migration, /Rejected payout does not have one exact reservation release\./)
  assert.match(migration, /Approved payout is not fully allocated and still reserved\./)
  assert.match(migration, /Released payout lacks one exact funded wallet disbursement\./)
})

test('application payout transitions write their matching protected ledger entries transactionally', () => {
  assert.match(adminRoute, /prisma\.\$transaction[\s\S]*releasePayoutFunds\(tx,/)
  assert.match(releaseRoute, /prisma\.\$transaction[\s\S]*finalizePayoutFunds\(tx,/)
})

test('audit evidence is append-only and payout lifecycle mismatches remain visible to Admin', () => {
  assert.match(migration, /CREATE TRIGGER "audit_logs_append_only"[\s\S]*BEFORE UPDATE OR DELETE ON "audit_logs"/)
  assert.match(integrityRoute, /unreconciled_payouts/)
  assert.match(integrityRoute, /payout_disbursement/)
  assert.match(integrityPage, /Payout lifecycle mismatches/)
})
