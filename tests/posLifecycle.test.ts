import assert from 'node:assert/strict'
import test from 'node:test'
import { availableOfflineQuantity, canTransitionPosTransaction, shouldFinalizeImmediately, validateOfflineQuantity } from '../src/app/lib/posLifecycle'

test('POS lifecycle allows retries but prevents finalized records from replaying', () => {
  assert.equal(canTransitionPosTransaction('pending_sync', 'syncing'), true)
  assert.equal(canTransitionPosTransaction('syncing', 'pending_sync'), true)
  assert.equal(canTransitionPosTransaction('approved', 'finalized'), true)
  assert.equal(canTransitionPosTransaction('finalized', 'syncing'), false)
})

test('offline allowance cannot oversell or accept invalid quantities', () => {
  assert.equal(availableOfflineQuantity(12, 5), 7)
  assert.equal(validateOfflineQuantity({ allocated: 12, consumed: 5, requested: 7 }), null)
  assert.match(validateOfflineQuantity({ allocated: 12, consumed: 5, requested: 8 }) || '', /Only 7 units/)
  assert.match(validateOfflineQuantity({ allocated: 12, consumed: 5, requested: 0 }) || '', /positive whole number/)
})

test('offline registrations remain reviewable while ordinary sales can finalize', () => {
  assert.equal(shouldFinalizeImmediately('member_sale'), true)
  assert.equal(shouldFinalizeImmediately('non_member_sale'), true)
  assert.equal(shouldFinalizeImmediately('new_reseller_registration'), false)
})
