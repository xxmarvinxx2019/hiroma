import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateProductBinaryPool, getProductBinaryPoolWeek } from '../src/app/lib/productBinaryPool'

test('prorates by qualified pairs when cascading exceeds the weekly pool', () => {
  const result = calculateProductBinaryPool(BigInt(1000), BigInt(500), [
    { userId: 'a', pairs: BigInt(100) }, { userId: 'b', pairs: BigInt(1900) },
  ])
  assert.equal(result.poolCentavos, BigInt(500000))
  assert.equal(result.rateNumerator / result.rateDenominator, BigInt(250))
  assert.deepEqual(result.allocations.map(row => row.amountCentavos), [BigInt(25000), BigInt(475000)])
})

test('caps the rate and keeps rounding within the pool', () => {
  assert.equal(calculateProductBinaryPool(BigInt(100), BigInt(500), [{ userId: 'a', pairs: BigInt(1) }]).allocations[0].amountCentavos, BigInt(500))
  const result = calculateProductBinaryPool(BigInt(1), BigInt(500), [
    { userId: 'a', pairs: BigInt(1) }, { userId: 'b', pairs: BigInt(2) },
  ])
  assert.deepEqual(result.allocations.map(row => row.amountCentavos), [BigInt(166), BigInt(333)])
  assert.equal(calculateProductBinaryPool(BigInt(1), BigInt(500), []).rateNumerator, BigInt(0))
})

test('Manila Monday midnight starts a new payout week', () => {
  const before = getProductBinaryPoolWeek(new Date('2026-11-08T15:59:59.999Z'))
  const after = getProductBinaryPoolWeek(new Date('2026-11-08T16:00:00.000Z'))
  assert.equal(before.start.toISOString(), '2026-11-01T16:00:00.000Z')
  assert.equal(before.endExclusive.toISOString(), after.start.toISOString())
  assert.equal(after.endExclusive.toISOString(), '2026-11-15T16:00:00.000Z')
})
