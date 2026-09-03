import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('payout requests reserve only unreserved wallet funds atomically', () => {
  const source = readFileSync('src/app/lib/payoutFunds.ts', 'utf8')
  const migration = readFileSync('prisma/migrations/20260902140000_add_financial_ledger_boundary/migration.sql', 'utf8')
  assert.match(source, /appendWalletLedgerEntryExactlyOnce/)
  assert.match(source, /entryType: 'payout_reservation'/)
  assert.match(migration, /source_available - earlier_pending < payout_row\."amount"/)
  assert.match(migration, /Payout reservation exceeds source-backed withdrawable funds/)
})

test('concurrent payout requests for one reseller are serialized', () => {
  const helper = readFileSync('src/app/lib/payoutFunds.ts', 'utf8')
  const route = readFileSync('src/app/api/reseller/wallet/route.ts', 'utf8')
  assert.match(helper, /lockFinancialUser\(tx, userId\)/)
  assert.match(route, /lockPayoutRequestsForUser\(tx, user\.id\)/)
  assert.match(route, /reservePayoutFunds\(tx, created\.id, user\.id, requestedAmount\)/)
})

test('admin and cron status changes use compare-and-set transitions', () => {
  const admin = readFileSync('src/app/api/admin/payouts/route.ts', 'utf8')
  const cron = readFileSync('src/app/api/cron/release-payouts/route.ts', 'utf8')
  assert.match(admin, /where: \{ id: payout_id, status: 'pending' \}/)
  assert.match(cron, /where: \{ id: payout\.id, status: 'approved' \}/)
  assert.match(cron, /if \(claimed\.count !== 1\) return false/)
  assert.match(cron, /CURRENT_TIMESTAMP AT TIME ZONE 'Asia\/Manila'/)
})

test('release deducts balance and reservation exactly once under database guards', () => {
  const source = readFileSync('src/app/lib/payoutFunds.ts', 'utf8')
  const migration = readFileSync('prisma/migrations/20260902140000_add_financial_ledger_boundary/migration.sql', 'utf8')
  assert.match(source, /entryType: 'payout_disbursement'/)
  assert.match(source, /balanceDelta: -amount/)
  assert.match(source, /reservedDelta: -amount/)
  assert.match(migration, /reservation_exists = false OR reservation_release_exists = true/)
  assert.match(migration, /Wallet ledger delta violates wallet balance invariants/)
})

test('database constraint rejects negative or over-reserved wallet state', () => {
  const migration = readFileSync('prisma/migrations/20260812200000_add_payout_fund_reservations/migration.sql', 'utf8')
  assert.match(migration, /"balance" >= 0/)
  assert.match(migration, /"reserved_balance" >= 0/)
  assert.match(migration, /"reserved_balance" <= "balance"/)
})
