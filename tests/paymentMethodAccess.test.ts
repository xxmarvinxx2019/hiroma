import assert from 'node:assert/strict'
import test from 'node:test'
import { canReadPaymentMethodTarget } from '../src/app/lib/paymentMethodAccess'

test('own and proven supplier payment methods are allowed', () => {
  assert.equal(canReadPaymentMethodTarget('city-a', 'city', 'city-a', null), true)
  assert.equal(canReadPaymentMethodTarget('city-a', 'city', 'provincial-a', 'provincial-a'), true)
  assert.equal(canReadPaymentMethodTarget('reseller-a', 'reseller', 'city-a', 'city-a'), true)
})

test('arbitrary unrelated payment method targets are blocked', () => {
  assert.equal(canReadPaymentMethodTarget('reseller-a', 'reseller', 'city-b', 'city-a'), false)
  assert.equal(canReadPaymentMethodTarget('city-a', 'city', 'provincial-b', 'provincial-a'), false)
  assert.equal(canReadPaymentMethodTarget('city-a', 'city', 'city-b', 'provincial-a'), false)
})

test('admin oversight remains allowed', () => {
  assert.equal(canReadPaymentMethodTarget('admin-a', 'admin', 'any-user', null), true)
})
