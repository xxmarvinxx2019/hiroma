import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateCollectedCash, isCashPaymentMethod } from '../src/app/lib/branchCash'

test('cash payment normalization excludes electronic payment methods', () => {
  assert.equal(isCashPaymentMethod('Cash'), true)
  assert.equal(isCashPaymentMethod('cash_on_pickup'), true)
  assert.equal(isCashPaymentMethod('cash on pickup'), true)
  assert.equal(isCashPaymentMethod('GCASH · Main Account'), false)
  assert.equal(isCashPaymentMethod('Bank Transfer'), false)
})

test('branch deposit expected cash includes only actual cash collections', async () => {
  const db = {
    order: {
      findMany: async () => [
        { total_amount: 1200, payment_method: 'cash' },
        { total_amount: 800, payment_method: 'Cash' },
        { total_amount: 500, payment_method: 'cash_on_pickup' },
        { total_amount: 3000, payment_method: 'GCASH · Branch Wallet' },
      ],
    },
    posRegistrationIntake: {
      findMany: async () => [
        { amount_snapshot: 2500, payment_method_snapshot: 'Cash' },
        { amount_snapshot: 4000, payment_method_snapshot: 'BANK · Company Account' },
      ],
    },
  }

  const result = await calculateCollectedCash(
    db as never,
    'branch-1',
    new Date('2026-08-29T00:00:00+08:00'),
    new Date('2026-08-30T00:00:00+08:00'),
  )

  assert.deepEqual(result, {
    productCash: 2500,
    registrationCash: 2500,
    total: 5000,
  })
})
