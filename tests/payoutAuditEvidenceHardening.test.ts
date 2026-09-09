import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { generatePayoutTransactionNumber } from '../src/app/lib/payoutTransactionNumber'

const migration = readFileSync(
  new URL('../prisma/migrations/20260902154000_enforce_payout_audit_evidence/migration.sql', import.meta.url),
  'utf8',
)
const adminRoute = readFileSync('src/app/api/admin/payouts/route.ts', 'utf8')
const requestRoute = readFileSync('src/app/api/reseller/wallet/route.ts', 'utf8')
const releaseRoute = readFileSync('src/app/api/cron/release-payouts/route.ts', 'utf8')

test('legacy payout audit chains are proved before the unique lifecycle-action boundary is installed', () => {
  const lock = migration.indexOf('LOCK TABLE')
  const orphanPreflight = migration.indexOf('Canonical payout audit rows reference no authoritative payout.')
  const chainPreflight = migration.indexOf('Existing payouts lack one exact canonical audit-evidence chain.')
  const uniqueIndex = migration.indexOf('CREATE UNIQUE INDEX "audit_logs_one_payout_lifecycle_action"')

  assert.ok(lock >= 0)
  assert.ok(lock < orphanPreflight)
  assert.ok(orphanPreflight < chainPreflight)
  assert.ok(chainPreflight < uniqueIndex)
  assert.match(migration, /unresolved_audit_rows=%s first_audit_ids=%s/)
  assert.match(migration, /unresolved_payouts=%s first_payout_ids=%s/)
  assert.match(migration, /Never synthesize requested, approved, rejected, or released evidence from payout status alone\./)
  for (const action of ['payout_requested', 'payout_approved', 'payout_rejected', 'payout_released']) {
    assert.ok(migration.includes(`'${action}'`), `missing canonical payout action ${action}`)
  }
})

test('the database authors request, processing, and release times before payout AFTER triggers run', () => {
  assert.match(migration, /IF NEW\."id" IS DISTINCT FROM OLD\."id"[\s\S]*Payout identity is immutable after creation\./)
  assert.match(migration, /NEW\."requested_at" := \(transaction_timestamp\(\) AT TIME ZONE 'UTC'\)::TIMESTAMP\(3\)/)
  assert.match(migration, /NEW\."processed_at" := \(transaction_timestamp\(\) AT TIME ZONE 'UTC'\)::TIMESTAMP\(3\)/)
  assert.match(migration, /NEW\."released_at" := transaction_timestamp\(\)/)
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION "enforce_payout_identity_and_status_transition"\(\)[\s\S]*NEW\."processed_at" := \(transaction_timestamp\(\) AT TIME ZONE 'UTC'\)::TIMESTAMP\(3\)/,
  )
})

test('payout state and audit evidence are checked in both directions at commit', () => {
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER "payouts_require_complete_audit_evidence"[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  )
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER "audit_logs_require_valid_payout_evidence"[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  )
  assert.match(migration, /Payout transition lacks one fresh exact canonical audit event\./)
  assert.match(migration, /NEW\."created_at" IS DISTINCT FROM transaction_timestamp\(\)/)
  assert.match(migration, /\(audit\."created_at" AT TIME ZONE 'UTC'\)::TIMESTAMP\(3\) IS NOT DISTINCT FROM NEW\."requested_at"/)
  assert.match(migration, /\(audit\."created_at" AT TIME ZONE 'UTC'\)::TIMESTAMP\(3\) IS NOT DISTINCT FROM NEW\."processed_at"/)
  assert.match(migration, /audit\."created_at" IS NOT DISTINCT FROM NEW\."released_at"/)
  assert.match(migration, /\(NEW\."created_at" AT TIME ZONE 'UTC'\)::TIMESTAMP\(3\) IS DISTINCT FROM payout_row\."requested_at"/)
  assert.match(migration, /\(NEW\."created_at" AT TIME ZONE 'UTC'\)::TIMESTAMP\(3\) IS DISTINCT FROM payout_row\."processed_at"/)
  assert.match(migration, /NEW\."created_at" IS DISTINCT FROM payout_row\."released_at"/)
  assert.match(migration, /audit\."user_id" IS DISTINCT FROM NEW\."approved_by"/)
  assert.match(migration, /audit\."metadata"->>'transaction_number' IS DISTINCT FROM NEW\."transaction_number"/)
  assert.match(migration, /REVOKE ALL ON FUNCTION "require_complete_payout_audit_evidence"\(\) FROM PUBLIC/)
  assert.match(migration, /REVOKE ALL ON FUNCTION "require_valid_payout_audit_evidence"\(\) FROM PUBLIC/)
})

test('deferred checks support the existing state-first audit-second order and explicitly grandfather only legacy evidence shape', () => {
  assert.ok(requestRoute.indexOf('const created = await tx.payout.create') < requestRoute.indexOf("activity_type: 'payout_requested'"))
  assert.ok(adminRoute.indexOf("status: 'approved'") < adminRoute.indexOf("activity_type: 'payout_approved'"))
  assert.ok(adminRoute.indexOf("status: 'rejected'") < adminRoute.indexOf("activity_type: 'payout_rejected'"))
  assert.ok(releaseRoute.indexOf("status: 'released'") < releaseRoute.indexOf("activity_type: 'payout_released'"))
  assert.match(migration, /Legacy stage timestamps predate database authorship/)
  assert.match(migration, /audit\."metadata" \? 'reseller_id'/)
  assert.match(migration, /NEW\."metadata"->>'reseller_id' IS DISTINCT FROM payout_row\."user_id"/)
})

test('all payout routes write the canonical metadata inside their state transaction', () => {
  assert.match(
    requestRoute,
    /prisma\.\$transaction[\s\S]*activity_type: 'payout_requested'[\s\S]*metadata: \{ payout_id: created\.id, reseller_id: user\.id, amount: requestedAmount, payment_method: resolvedMethod, batch_id: batchId \}/,
  )
  assert.match(
    adminRoute,
    /prisma\.\$transaction[\s\S]*activity_type: 'payout_approved'[\s\S]*metadata: \{ payout_id, reseller_id: payout\.user_id, amount: Number\(payout\.amount\), transaction_number: txNumber \}/,
  )
  assert.match(
    adminRoute,
    /prisma\.\$transaction[\s\S]*activity_type: 'payout_rejected'[\s\S]*metadata: \{ payout_id, reseller_id: payout\.user_id, amount: Number\(payout\.amount\), notes: notes \|\| null \}/,
  )
  assert.match(releaseRoute, /activity_type: 'payout_released'[\s\S]*reseller_id: payout\.user_id/)
  assert.match(releaseRoute, /activity_type: 'payout_released'[\s\S]*actor_type: 'system'/)
})

test('payout transaction numbers are collision-free for distinct payout IDs and stable on retry', () => {
  const requestedAt = new Date('2026-12-31T23:59:59.000Z')
  const first = generatePayoutTransactionNumber('payout-a', requestedAt)

  assert.equal(first, 'PAY-2026-payout-a')
  assert.equal(generatePayoutTransactionNumber('payout-a', requestedAt), first)
  assert.notEqual(generatePayoutTransactionNumber('payout-b', requestedAt), first)
  assert.doesNotMatch(adminRoute, /Math\.random/)
  assert.match(adminRoute, /generatePayoutTransactionNumber\(payout\.id, payout\.requested_at\)/)
})
