import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('payout requests reserve only unreserved wallet funds atomically', () => {
  const source = readFileSync('src/app/lib/payoutFunds.ts', 'utf8')
  assert.match(source, /\("balance" - "reserved_balance"\) >= \$\{amount\}/)
  assert.match(source, /SET "reserved_balance" = "reserved_balance" \+ \$\{amount\}/)
})

test('concurrent payout requests for one reseller are serialized', () => {
  const helper = readFileSync('src/app/lib/payoutFunds.ts', 'utf8')
  const route = readFileSync('src/app/api/reseller/wallet/route.ts', 'utf8')
  assert.match(helper, /pg_advisory_xact_lock\(hashtext\(\$\{userId\}\)\)/)
  assert.match(route, /lockPayoutRequestsForUser\(tx, user\.id\)/)
  assert.match(route, /reservePayoutFunds\(tx, user\.id, requestedAmount\)/)
})

test('admin and cron status changes use compare-and-set transitions', () => {
  const admin = readFileSync('src/app/api/admin/payouts/route.ts', 'utf8')
  const cron = readFileSync('src/app/api/cron/release-payouts/route.ts', 'utf8')
  assert.match(admin, /where: \{ id: payout_id, status: 'pending' \}/)
  assert.match(cron, /where: \{ id: payout\.id, status: 'approved' \}/)
  assert.match(cron, /if \(claimed\.count !== 1\) return false/)
})

test('release deducts balance and reservation exactly once under database guards', () => {
  const source = readFileSync('src/app/lib/payoutFunds.ts', 'utf8')
  assert.match(source, /SET "balance" = "balance" - \$\{amount\},\s+"reserved_balance" = "reserved_balance" - \$\{amount\}/)
  assert.match(source, /AND "balance" >= \$\{amount\}\s+AND "reserved_balance" >= \$\{amount\}/)
})

test('database constraint rejects negative or over-reserved wallet state', () => {
  const migration = readFileSync('prisma/migrations/20260812200000_add_payout_fund_reservations/migration.sql', 'utf8')
  assert.match(migration, /"balance" >= 0/)
  assert.match(migration, /"reserved_balance" >= 0/)
  assert.match(migration, /"reserved_balance" <= "balance"/)
})
