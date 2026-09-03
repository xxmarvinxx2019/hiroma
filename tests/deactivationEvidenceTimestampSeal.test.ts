import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  'prisma/migrations/20260902148000_seal_deactivation_evidence_timestamps/migration.sql',
  'utf8',
)
const route = readFileSync('src/app/api/admin/resellers/[id]/status/route.ts', 'utf8')

test('PostgreSQL authors deactivation and audit evidence timestamps', () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION "stamp_deactivation_liability_version"\(\)[\s\S]*NEW\."created_at" := transaction_timestamp\(\)/,
  )
  assert.match(
    migration,
    /CREATE TRIGGER "audit_logs_stamp_evidence_time"[\s\S]*BEFORE INSERT ON "audit_logs"/,
  )
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION "stamp_audit_log_evidence_time"\(\)[\s\S]*?NEW\."created_at" := transaction_timestamp\(\)/,
  )
})

test('future-dated evidence cannot satisfy a later reseller status transition', () => {
  const transition = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION "verify_reseller_status_transition"'))
  assert.match(transition, /event\."created_at" = transaction_timestamp\(\)/)
  assert.match(transition, /audit\."created_at" = transaction_timestamp\(\)/)
  assert.doesNotMatch(transition, /"created_at"\s*>=\s*transaction_timestamp\(\)/)
  assert.match(migration, /audit\."created_at" = NEW\."created_at"/)
  assert.match(migration, /NEW\."created_at" IS DISTINCT FROM transaction_timestamp\(\)/)
})

test('inactive status independently requires every financial state to close at zero', () => {
  const transition = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION "verify_reseller_status_transition"'))
  assert.match(transition, /wallet_count <> 1 OR wallet_balance <> 0 OR wallet_reserved <> 0/)
  assert.match(transition, /remaining_payable <> 0 OR open_payout_count <> 0/)
  assert.match(transition, /profile_left <> 0 OR profile_right <> 0/)
  assert.match(transition, /product_left <> 0 OR product_right <> 0/)
  assert.match(transition, /'pending'::"PayoutStatus", 'approved'::"PayoutStatus"/)
})

test('deactivation clears both package and product binary carryovers before recording its event', () => {
  const packageReset = route.indexOf('SET left_points = 0, right_points = 0, is_active = false')
  const productReset = route.indexOf('SET left_carryover_pu = 0, right_carryover_pu = 0')
  const event = route.indexOf('tx.resellerDeactivationEvent.create')
  assert.ok(packageReset >= 0 && productReset > packageReset && event > productReset)
})

test('suspension remains audited but does not require financial liquidation', () => {
  const transition = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION "verify_reseller_status_transition"'))
  const inactiveBranch = transition.indexOf(`IF NEW."status" = 'inactive'::"UserStatus" THEN`)
  const auditedElse = transition.indexOf('ELSE', inactiveBranch)
  const endBranch = transition.indexOf('END IF;', auditedElse)
  const suspensionBranch = transition.slice(auditedElse, endBranch)
  assert.match(suspensionBranch, /activity_type" = 'reseller_status_changed'/)
  assert.match(suspensionBranch, /Reseller activation or suspension requires one fresh immutable audit event/)
  assert.doesNotMatch(suspensionBranch, /remaining_payable|wallet_balance|product_left/)
})
