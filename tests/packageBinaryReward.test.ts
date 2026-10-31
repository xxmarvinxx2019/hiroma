import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PACKAGE_REWARD_POLICY, splitPackageRewardPairs, validatePackageRewardPolicy } from '../src/app/lib/packageBinaryReward'

const policy = { enabled: true, interval: 5, product_id: 'bottle' }

test('fifth eligible pair replaces cash with one bottle, including batched crossings', () => {
  assert.deepEqual(splitPackageRewardPairs(0, 4, policy), { cashPairs: 4, productPairs: 0, opening: 0, closing: 4 })
  assert.deepEqual(splitPackageRewardPairs(4, 1, policy), { cashPairs: 0, productPairs: 1, opening: 4, closing: 5 })
  assert.deepEqual(splitPackageRewardPairs(4, 12, policy), { cashPairs: 9, productPairs: 3, opening: 4, closing: 16 })
})

test('interval change preserves eligible ordinals and does not reissue earlier bottles', () => {
  assert.equal(splitPackageRewardPairs(4, 1, { ...policy, interval: 6 }).productPairs, 0)
  assert.equal(splitPackageRewardPairs(5, 1, { ...policy, interval: 6 }).productPairs, 1)
  assert.equal(splitPackageRewardPairs(10, 1, { ...policy, interval: 3 }).productPairs, 0)
  assert.equal(splitPackageRewardPairs(10, 2, { ...policy, interval: 3 }).productPairs, 1)
})

test('disabled and zero-eligible events neither grant bottles nor advance progress', () => {
  assert.deepEqual(splitPackageRewardPairs(4, 20, DEFAULT_PACKAGE_REWARD_POLICY), { cashPairs: 20, productPairs: 0, opening: 4, closing: 4 })
  assert.deepEqual(splitPackageRewardPairs(4, 0, policy), { cashPairs: 0, productPairs: 0, opening: 4, closing: 4 })
})

test('policy rejects fractional/invalid intervals, coercion and missing bottle configuration', () => {
  for (const interval of [0, 1, -1, 5.5, 1001, NaN, '5', null]) {
    assert.throws(() => validatePackageRewardPolicy({ ...policy, interval }))
  }
  assert.throws(() => validatePackageRewardPolicy({ ...policy, enabled: 'true' }))
  assert.throws(() => validatePackageRewardPolicy({ ...policy, product_id: null }))
  assert.throws(() => splitPackageRewardPairs(Number.MAX_SAFE_INTEGER, 1, policy))
})

test('batched payout splitting equals an independent pair-by-pair oracle', () => {
  for (const interval of [2, 3, 5, 6, 20, 1000]) {
    for (let opening = 0; opening < 1100; opening += 7) {
      const eligible = (opening * 13 + 17) % 101
      let bottles = 0
      for (let ordinal = opening + 1; ordinal <= opening + eligible; ordinal++) if (ordinal % interval === 0) bottles++
      const result = splitPackageRewardPairs(opening, eligible, { ...policy, interval })
      assert.equal(result.productPairs, bottles)
      assert.equal(result.cashPairs + result.productPairs, eligible)
    }
  }
})
