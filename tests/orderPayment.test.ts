import test from 'node:test'
import assert from 'node:assert/strict'
import { isElectronicOrderPayment, orderPaymentDeadline, ORDER_PAYMENT_WINDOW_MS } from '../src/app/lib/orderPayment'
import { readFileSync } from 'node:fs'

test('electronic order payment gets a strict 48-hour deadline', () => {
  const created = new Date('2026-09-12T00:00:00.000Z')
  assert.equal(orderPaymentDeadline(created).getTime(), created.getTime() + ORDER_PAYMENT_WINDOW_MS)
})

test('pickup time shortens but never extends the payment window', () => {
  const created = new Date('2026-09-12T00:00:00.000Z')
  const earlyPickup = new Date('2026-09-13T00:00:00.000Z')
  const latePickup = new Date('2026-09-20T00:00:00.000Z')
  assert.equal(orderPaymentDeadline(created, earlyPickup).getTime(), earlyPickup.getTime())
  assert.equal(orderPaymentDeadline(created, latePickup).getTime(), created.getTime() + ORDER_PAYMENT_WINDOW_MS)
})

test('only GCash and bank transfer require electronic proof', () => {
  assert.equal(isElectronicOrderPayment('gcash'), true)
  assert.equal(isElectronicOrderPayment('bank_transfer'), true)
  assert.equal(isElectronicOrderPayment('cash_on_pickup'), false)
})

test('reseller checkout binds an exact enabled approved destination and freezes its details', () => {
  const route = readFileSync('src/app/api/reseller/orders/route.ts', 'utf8')
  assert.match(route, /id: payment_method_id, user_id: seller\.id, status: 'approved', is_enabled: true/)
  assert.match(route, /payment_destination_snapshot: paymentDestinationSnapshot/)
  assert.doesNotMatch(route, /action === 'mark_paid'[\s\S]*payment_status: 'paid'/)
})

test('payment proof is deadline-bound and requires seller verification', () => {
  const route = readFileSync('src/app/api/orders/[id]/payment/route.ts', 'utf8')
  assert.match(route, /payment_due_at: \{ gt: new Date\(\) \}/)
  assert.match(route, /payment_status: 'verification_pending'/)
  assert.match(route, /order\.seller_id !== user\.id/)
  assert.doesNotMatch(route, /\.\.\.item,/)
})

test('payment review atomically claims pending evidence and records the actual actor', () => {
  const route = readFileSync('src/app/api/orders/[id]/payment/route.ts', 'utf8')
  assert.match(route, /orderPaymentEvidence\.updateMany/)
  assert.match(route, /where: \{ id: evidence\.id, order_id: id, status: 'submitted' \}/)
  assert.match(route, /where: \{ id, seller_id: user\.id, status: 'pending', payment_status: 'verification_pending' \}/)
  assert.match(route, /const actorId = user\.actor_id \|\| user\.id/)
  assert.match(route, /payment_verified_by_actor_id: actorId/)
})

test('proof submission and cancellation cannot cross into a cancelled review state', () => {
  const paymentRoute = readFileSync('src/app/api/orders/[id]/payment/route.ts', 'utf8')
  const resellerRoute = readFileSync('src/app/api/reseller/orders/route.ts', 'utf8')
  const cityRoute = readFileSync('src/app/api/city/orders/route.ts', 'utf8')
  assert.match(paymentRoute, /where: \{ id, buyer_id: user\.id, status: 'pending', payment_status:/)
  assert.match(resellerRoute, /payment_status: \{ notIn: \['verification_pending', 'paid'\] \}/)
  assert.match(cityRoute, /status === 'cancelled' && electronicPayment/)
  assert.match(cityRoute, /payment_status: \{ notIn: \['verification_pending', 'paid'\] \}/)
})

test('expiry excludes proof awaiting review and releases reserved inventory', () => {
  const route = readFileSync('src/app/api/cron/expire-unpaid-orders/route.ts', 'utf8')
  assert.match(route, /payment_status: \{ in: \['awaiting_payment', 'payment_rejected'\] \}/)
  assert.doesNotMatch(route, /verification_pending/)
  assert.match(route, /releaseOrderStock/)
  assert.match(route, /while \(!budgetReached\)/)
  assert.match(route, /orderBy: \[\{ payment_due_at: 'asc' \}, \{ id: 'asc' \}\]/)
})
