import assert from 'node:assert/strict'
import test from 'node:test'
import { validateProductPuExpiryMonths } from '../src/app/lib/productPuExpiryPolicy'

test('Product PU policy accepts only bounded whole months', () => {
  for (const value of [1, 6, 12, 24, 120]) assert.equal(validateProductPuExpiryMonths(value), value)
  for (const value of [0, -1, 121, 1.5, NaN, Infinity, '12', null]) assert.throws(() => validateProductPuExpiryMonths(value))
})
