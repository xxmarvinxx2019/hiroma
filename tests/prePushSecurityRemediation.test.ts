import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('direct-referral payout allocation waits for member lots and safely resumes a partial allocation', () => {
  const sql = readFileSync('prisma/migrations/20260804200000_add_direct_referral_reserve_ledger/migration.sql', 'utf8')
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(target_user_id, 0\)\)/)
  assert.match(sql, /payout_amount - COALESCE\(SUM\("amount"\), 0\)/)
  assert.doesNotMatch(sql, /FOR UPDATE SKIP LOCKED/)
  assert.doesNotMatch(sql, /OR EXISTS \(\s*SELECT 1 FROM "direct_referral_payout_consumptions"/)
})

test('support ticket sequence handles both empty and populated databases', () => {
  const sql = readFileSync('prisma/migrations/20260808190000_standardize_support_ticket_numbers/migration.sql', 'utf8')
  assert.match(sql, /COALESCE\(MAX\(row_number\), 1\)/)
  assert.match(sql, /MAX\(row_number\) IS NOT NULL/)
})

test('reseller status updates remain role-scoped and compare-and-set', () => {
  const route = readFileSync('src/app/api/admin/resellers/[id]/status/route.ts', 'utf8')
  assert.match(route, /if \(reseller\.role !== 'reseller'\)/)
  assert.match(route, /where: \{ id: userId, role: 'reseller', status: reseller\.status \}/)
  assert.match(route, /if \(claimed\.count !== 1\) throw new ConcurrentDeactivationError\(\)/)
})

test('security PIN verification serializes and increments failures atomically', () => {
  const helper = readFileSync('src/app/lib/resellerSecurityPin.ts', 'utf8')
  assert.match(helper, /prisma\.\$transaction\(async \(tx\) =>/)
  assert.match(helper, /FOR UPDATE/)
  assert.match(helper, /two_factor_failed_attempts: \{ increment: 1 \}/)
})

test('payout summaries are computed independently from the bounded detail ledger', () => {
  const route = readFileSync('src/app/api/admin/commission-testing/payout-ledger/route.ts', 'utf8')
  assert.match(route, /const \[summaryRows, rows\] = await Promise\.all/)
  assert.match(route, /LIMIT 500/)
  assert.match(route, /summaryRows\[0\]/)
})

test('released accounting uses released_at and reserve movements avoid multiplicative joins', () => {
  const product = readFileSync('src/app/api/admin/commission-testing/product-binary/route.ts', 'utf8')
  const reserve = readFileSync('src/app/api/admin/commission-testing/reserve-ledger/route.ts', 'utf8')
  assert.match(product, /COALESCE\(p\.released_at,p\.payout_date,p\.processed_at,p\.requested_at\)/)
  assert.match(reserve, /JOIN direct_referral_payout_consumptions c ON c\.payout_id=p\.id/)
  assert.match(reserve, /JOIN binary_payout_consumptions c ON c\.payout_id=p\.id/)
  assert.match(reserve, /JOIN product_binary_payout_consumptions c ON c\.payout_id=p\.id/)
  assert.doesNotMatch(reserve, /LEFT JOIN direct_referral_payout_consumptions/)
})
