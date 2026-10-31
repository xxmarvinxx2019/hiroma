import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { canAccessRewardStock, parseRewardStockDispatch } from '../src/app/lib/rewardStockReplacement'
import type { JWTPayload } from '../src/app/lib/auth'

test('replacement access is inventory-specific and never a reseller/cashier permission', () => {
  const user = { id: 'owner', username: 'owner', full_name: 'Owner', role: 'city' } as JWTPayload
  assert.equal(canAccessRewardStock(user, true), true)
  assert.equal(canAccessRewardStock({ ...user, role: 'reseller' }), false)
  assert.equal(canAccessRewardStock({ ...user, is_staff: true, permissions: ['pos'] }), false)
  assert.equal(canAccessRewardStock({ ...user, is_staff: true, permissions: ['inventory'] }, true), true)
  const admin = { ...user, role: 'admin', is_staff: true, permissions: ['inventory:view'] } as JWTPayload
  assert.equal(canAccessRewardStock(admin), true); assert.equal(canAccessRewardStock(admin, true), false)
})

test('dispatch input rejects free-form balances, unsupported kinds and invalid quantities', () => {
  const input = { client_request_id: randomUUID(), recipient_id: 'city', product_id: 'bottle', kind: 'distributor_replacement', quantity: 1 }
  assert.deepEqual(parseRewardStockDispatch(input), input)
  for (const quantity of [0, -1, 1.5, 101, '1']) assert.throws(() => parseRewardStockDispatch({ ...input, quantity }))
  assert.throws(() => parseRewardStockDispatch({ ...input, kind: 'cash' }))
})
