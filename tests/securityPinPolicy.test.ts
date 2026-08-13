import assert from 'node:assert/strict'
import test from 'node:test'
import { isSecurityPinEligibleRole } from '../src/app/lib/securityPinPolicy'

test('security PIN is available to member, distributor, and admin owners only', () => {
  for (const role of ['reseller', 'regional', 'provincial', 'city']) assert.equal(isSecurityPinEligibleRole(role), true)
  assert.equal(isSecurityPinEligibleRole('admin'), true)
  assert.equal(isSecurityPinEligibleRole('staff'), false)
})
