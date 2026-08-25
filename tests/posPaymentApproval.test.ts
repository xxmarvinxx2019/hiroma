import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { firstCityStaffRoute } from '../src/app/lib/staffPermissions'

const read = (path: string) => readFileSync(path, 'utf8')

test('POS maker and approver permissions are separate', () => {
  const permissions = read('src/app/lib/staffPermissions.ts')
  const middleware = read('src/middleware.ts')
  assert.match(permissions, /key: 'pos_approve'/)
  assert.match(middleware, /pos\/approvals[\s\S]*return 'pos_approve'/)
})

test('restricted city staff are redirected to their first permitted workspace', () => {
  assert.equal(firstCityStaffRoute(['pos', 'inventory']), '/dashboard/city/pos')
  assert.equal(firstCityStaffRoute(['inventory', 'reports', 'pos_approve']), '/dashboard/city/pos/approvals')
  assert.equal(firstCityStaffRoute([]), '/login/distributor')
})

test('non-cash POS sales wait for independent payment verification', () => {
  const transactions = read('src/app/api/city/pos/transactions/route.ts')
  assert.match(transactions, /requiresApproval \? 'synced_pending_review' : 'finalized'/)
  assert.match(transactions, /requiresApproval \? 'pending_verification' : 'paid'/)
  assert.match(transactions, /POS_PAYMENT_REFERENCE_DUPLICATE/)
})

test('offline POS checkout is cash-only in both the client and server', () => {
  const page = read('src/app/dashboard/city/pos/page.tsx')
  const transactions = read('src/app/api/city/pos/transactions/route.ts')
  const bootstrap = read('src/app/api/city/pos/bootstrap/route.ts')
  assert.match(page, /setPaymentMethod\("cash"\)/)
  assert.match(page, /captured_offline: !online/)
  assert.match(page, /disabled=\{!online\}/)
  assert.match(page, /Offline mode: Cash only\./)
  assert.match(transactions, /capturedOffline && paymentSelection !== 'cash'/)
  assert.match(transactions, /OFFLINE_CASH_ONLY/)
  assert.match(bootstrap, /payment_methods: \['cash'\]/)
})

test('POS visibly identifies the authenticated cashier', () => {
  const page = read('src/app/dashboard/city/pos/page.tsx')
  const bootstrap = read('src/app/api/city/pos/bootstrap/route.ts')
  assert.match(bootstrap, /full_name: user\.actor_name \|\| user\.full_name/)
  assert.match(bootstrap, /username: user\.actor_username \|\| user\.username/)
  assert.match(page, /Logged-in cashier/)
  assert.match(page, /cashier_name: data\.cashier\.full_name/)
})

test('approver cannot review their own payment and rejection restores reserved stock', () => {
  const approvals = read('src/app/api/city/pos/approvals/route.ts')
  assert.match(approvals, /transaction\.cashier_id === actorId/)
  assert.match(approvals, /POS_SELF_APPROVAL/)
  assert.match(approvals, /quantity: \{ increment: item\.quantity \}/)
  assert.match(approvals, /payment_status: 'rejected'/)
})

test('payment account and reference are unique together', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260825170000_add_pos_payment_approval/migration.sql')
  assert.match(schema, /@@unique\(\[payment_method_id, payment_reference\]\)/)
  assert.match(migration, /pos_transactions_payment_method_id_payment_reference_key/)
})
