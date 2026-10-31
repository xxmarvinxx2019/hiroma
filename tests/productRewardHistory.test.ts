import assert from 'node:assert/strict'
import test from 'node:test'
import { rewardHistoryPagination } from '../src/app/lib/productRewardHistory'

test('reward history has bounded pagination and rejects malformed client values', () => {
  assert.deepEqual(rewardHistoryPagination(new URLSearchParams()), { page: 1, pageSize: 20 })
  assert.deepEqual(rewardHistoryPagination(new URLSearchParams('page=2&page_size=50')), { page: 2, pageSize: 50 })
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=1000001', 'page=', 'page_size=0', 'page_size=51', 'page_size=Infinity']) {
    assert.throws(() => rewardHistoryPagination(new URLSearchParams(query)), /Invalid history pagination/)
  }
})
