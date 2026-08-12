import assert from 'node:assert/strict'
import test from 'node:test'
import { isRoleAllowedInPortal } from '../src/app/lib/loginPortal'

test('portal role separation and legacy compatibility', () => {
  assert.equal(isRoleAllowedInPortal('reseller', 'member'), true)
  assert.equal(isRoleAllowedInPortal('city', 'member'), false)
  for (const role of ['regional', 'provincial', 'city'] as const) assert.equal(isRoleAllowedInPortal(role, 'distributor'), true)
  assert.equal(isRoleAllowedInPortal('reseller', 'distributor'), false)
  assert.equal(isRoleAllowedInPortal('admin', 'admin'), true)
  assert.equal(isRoleAllowedInPortal('city', 'admin'), false)
  assert.equal(isRoleAllowedInPortal('reseller', 'legacy'), true)
  assert.equal(isRoleAllowedInPortal('admin', 'legacy'), true)
})
