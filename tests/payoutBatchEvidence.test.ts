import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const route = read('src/app/api/admin/payouts/batch/route.ts')
const migration = read('prisma/migrations/20260911100000_add_payout_disbursement_evidence/migration.sql')
const cron = read('src/app/api/cron/release-payouts/route.ts')
const page = read('src/app/dashboard/admin/payouts/PayoutBatchTools.tsx')

test('payout releases require immutable external evidence', () => {
  assert.match(migration, /Payout release requires complete matching external disbursement evidence/)
  assert.match(migration, /NEW\."disbursed_amount" IS DISTINCT FROM NEW\."amount"/)
  assert.match(migration, /CREATE UNIQUE INDEX "payouts_disbursement_provider_external_reference_key"/)
  assert.match(migration, /Payout releaser must be an active administrator/)
})

test('batch import rejects changed amounts, batches, duplicates, and future timestamps', () => {
  assert.match(route, /Amount does not match approved amount/)
  assert.match(route, /Wrong batch/)
  assert.match(route, /Duplicate provider\/reference/)
  assert.match(route, /disbursedAt > now/)
  assert.match(route, /status: 'released'[\s\S]*disbursement_provider/)
  assert.match(route, /finalizePayoutFunds/)
})

test('maker destinations require owner PIN and ordinary payout UI remains masked', () => {
  assert.match(route, /Only the Admin owner can access full payout destinations/)
  assert.match(route, /verifyResellerSecurityPin/)
  assert.match(page, /Download secured maker Excel/)
  assert.match(page, /Validation preview/)
  assert.match(read('src/app/dashboard/admin/payouts/page.tsx'), /maskDestination/)
  assert.match(read('src/app/api/admin/payouts/route.ts'), /maskPayoutDestination\(p\.payment_reference\)/)
  assert.match(read('src/app/api/admin/payouts\/\[id\]\/route.ts'), /maskPayoutDestination\(payout\.payment_reference\)/)
})

test('payout date cron cannot release without bank or wallet evidence', () => {
  assert.doesNotMatch(cron, /status:\s*'released'/)
  assert.match(cron, /remain approved until external disbursement evidence is confirmed/)
})
