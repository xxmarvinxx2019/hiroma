import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canUpdateOrderPaymentStatus,
  isAllowedOrderPaymentStatus,
} from '../src/app/lib/orderPaymentAuthorization'

test('only the seller can update an order payment status', () => {
  const order = { buyer_id: 'buyer-a', seller_id: 'seller-a' }
  assert.equal(canUpdateOrderPaymentStatus('seller-a', order), true)
  assert.equal(canUpdateOrderPaymentStatus('buyer-a', order), false)
  assert.equal(canUpdateOrderPaymentStatus('unrelated-a', order), false)
})

test('payment status is restricted to the supported values', () => {
  assert.equal(isAllowedOrderPaymentStatus('paid'), true)
  assert.equal(isAllowedOrderPaymentStatus('unpaid'), true)
  assert.equal(isAllowedOrderPaymentStatus('refunded'), false)
  assert.equal(isAllowedOrderPaymentStatus({ value: 'paid' }), false)
})

test('all upstream order routes enforce seller-only payment confirmation before mutation', () => {
  for (const path of [
    'src/app/api/city/orders/route.ts',
    'src/app/api/provincial/orders/route.ts',
    'src/app/api/regional/orders/route.ts',
  ]) {
    const source = readFileSync(path, 'utf8')
    const authorization = source.indexOf('payment_status && !canUpdateOrderPaymentStatus(user.id, order)')
    const transaction = source.indexOf('const updated = await prisma.$transaction', authorization)
    assert.notEqual(authorization, -1)
    assert.notEqual(transaction, -1)
    assert.ok(authorization < transaction)
    assert.match(source, /payment_status && !isAllowedOrderPaymentStatus\(payment_status\)/)
    assert.match(source, /Only the seller can confirm payment/)
  }
})

test('city cash-on-pickup delivery remains seller-controlled and auto-paid', () => {
  const source = readFileSync('src/app/api/city/orders/route.ts', 'utf8')
  assert.match(source, /const cashCollectedAtPickup = status === 'delivered'/)
  assert.match(source, /cashCollectedAtPickup && \{ payment_status: 'paid' \}/)
})
