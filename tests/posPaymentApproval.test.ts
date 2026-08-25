import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

test('POS maker and approver permissions are separate', () => {
  const permissions = read('src/app/lib/staffPermissions.ts')
  const middleware = read('src/middleware.ts')
  assert.match(permissions, /key: 'pos_approve'/)
  assert.match(middleware, /pos\/approvals[\s\S]*return 'pos_approve'/)
})

test('non-cash POS sales wait for independent payment verification', () => {
  const transactions = read('src/app/api/city/pos/transactions/route.ts')
  assert.match(transactions, /requiresApproval \? 'synced_pending_review' : 'finalized'/)
  assert.match(transactions, /requiresApproval \? 'pending_verification' : 'paid'/)
  assert.match(transactions, /POS_PAYMENT_REFERENCE_DUPLICATE/)
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
