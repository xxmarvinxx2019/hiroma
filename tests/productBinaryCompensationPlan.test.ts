import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getProductBinaryDailyCap,
  PRODUCT_BINARY_DAILY_CAPS,
  PRODUCT_BINARY_PAIR_AMOUNT,
  PRODUCT_BINARY_PAIR_POINTS,
} from '../src/app/lib/productBinaryPlan'

test('Product Binary pays a fixed PHP 5 for every plan', () => {
  assert.equal(PRODUCT_BINARY_PAIR_AMOUNT, 5)
  assert.equal(PRODUCT_BINARY_PAIR_POINTS, 10)
})

test('Product Binary daily limits follow the approved package plan', () => {
  assert.deepEqual(PRODUCT_BINARY_DAILY_CAPS, { starter: 20, silver: 40, gold: 100 })
  assert.equal(getProductBinaryDailyCap('Starter'), 20)
  assert.equal(getProductBinaryDailyCap(' SILVER '), 40)
  assert.equal(getProductBinaryDailyCap('gold'), 100)
})
