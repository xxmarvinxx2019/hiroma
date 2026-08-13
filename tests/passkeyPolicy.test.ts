import test from 'node:test'
import assert from 'node:assert/strict'
import { isPasskeyEligible, normalizeDeviceName } from '../src/app/lib/passkeyPolicy'

const reseller = { role: 'reseller', status: 'active', login_disabled: false }

test('passkeys are available to active member, distributor, and admin owners', () => {
  assert.equal(isPasskeyEligible(reseller), true)
  assert.equal(isPasskeyEligible({ ...reseller, role: 'admin' }), true)
  assert.equal(isPasskeyEligible({ ...reseller, role: 'regional' }), true)
  assert.equal(isPasskeyEligible({ ...reseller, role: 'provincial' }), true)
  assert.equal(isPasskeyEligible({ ...reseller, role: 'city' }), true)
  assert.equal(isPasskeyEligible({ ...reseller, status: 'suspended' }), false)
  assert.equal(isPasskeyEligible({ ...reseller, login_disabled: true }), false)
})

test('device names are normalized and bounded', () => {
  assert.equal(normalizeDeviceName('  My   iPhone  '), 'My iPhone')
  assert.equal(normalizeDeviceName('x'), null)
  assert.equal(normalizeDeviceName('x'.repeat(61)), null)
  assert.equal(normalizeDeviceName(null), null)
})
