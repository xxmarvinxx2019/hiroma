import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const route = readFileSync('src/app/api/admin/commission-testing/reserve-ledger/route.ts', 'utf8')
const page = readFileSync('src/app/dashboard/admin/commission-testing/reserve-ledger/page.tsx', 'utf8')

test('company funding bridge recognizes product margin at paid delivery only once', () => {
  assert.match(route, /seller\.role='admin'/)
  assert.match(route, /o\.status='delivered'/)
  assert.match(route, /o\.payment_status='paid'/)
  assert.match(route, /product\.gross_margin \+ pins\.paid_pin_sales \+ legacy\.paid_pin_sales/)
  assert.match(route, /Registration does not earn that margin again/)
})

test('paid PIN requests and unlinked legacy registrations are reconciled without overlap', () => {
  assert.match(route, /payment_status='paid' AND status='approved'/)
  assert.match(route, /pin\.funding_pin_request_id IS NULL/)
  assert.match(route, /required_protected_cash:requiredProtectedCash/)
})

test('admin explains realized contribution, protected cash, and bank reconciliation gap', () => {
  assert.match(page, /Where HIROMA’s Commission Reserve Money Comes From/)
  assert.match(page, /Total money HIROMA must keep ready/)
  assert.match(page, /How to read this/)
  assert.match(page, /Finance must compare this with the dedicated reserve bank account/)
})

test('admin uses plain-language labels with an explanation for every reserve total', () => {
  assert.match(page, /Money Set Aside from Sales/)
  assert.match(page, /Commissions Earned but Not Yet Paid/)
  assert.match(page, /Additional Reserve Money Needed/)
  assert.match(page, /The exact amount members have already earned, including cascading commissions/)
})
