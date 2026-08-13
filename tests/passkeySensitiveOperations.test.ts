import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (path: string) => readFileSync(path, 'utf8')
const loadPinPolicy = async () => {
  process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/hiroma_test'
  process.env.JWT_SECRET ||= 'test-only-secret-at-least-32-characters-long'
  return import('../src/app/lib/resellerSecurityPin')
}

test('PIN-disabled reseller sessions cannot authorize sensitive operations', async () => {
  const { getSensitiveResellerPinFailure, isSensitiveResellerPinAccepted } = await loadPinPolicy()
  const verification = { required: false, valid: true }
  assert.equal(isSensitiveResellerPinAccepted(verification), false)
  assert.deepEqual(getSensitiveResellerPinFailure(verification), {
    error: 'Configure your six-digit security PIN before continuing.',
    status: 403,
  })
})

test('only a configured and valid reseller PIN is accepted', async () => {
  const { isSensitiveResellerPinAccepted } = await loadPinPolicy()
  assert.equal(isSensitiveResellerPinAccepted({ required: true, valid: true }), true)
  assert.equal(isSensitiveResellerPinAccepted({ required: true, valid: false }), false)
})

test('payout and reseller payment-method mutations use the strict PIN boundary', () => {
  const wallet = source('src/app/api/reseller/wallet/route.ts')
  const paymentMethods = source('src/app/api/payment-methods/route.ts')
  assert.match(wallet, /isSensitiveResellerPinAccepted\(pinVerification\)/)
  assert.equal((paymentMethods.match(/isSensitiveResellerPinAccepted\(pinVerification\)/g) || []).length, 2)
  assert.match(paymentMethods, /if \(user\.role === 'reseller'\)/)
})

test('passkey login bypasses only the login PIN while device and password changes retain confirmation', () => {
  const passkeyLogin = source('src/app/api/auth/passkey/authenticate/verify/route.ts')
  const passkeyRegistration = source('src/app/api/auth/passkey/register/options/route.ts')
  const passkeyDevices = source('src/app/api/reseller/passkeys/route.ts')
  const passwordChange = source('src/app/api/reseller/profile/password/route.ts')
  assert.match(passkeyLogin, /setAuthCookie/)
  assert.doesNotMatch(passkeyLogin, /login\/pin/)
  assert.match(passkeyRegistration, /verifyPassword/)
  assert.match(passkeyDevices, /verifyPassword/)
  assert.match(passwordChange, /current_password/)
  assert.match(passwordChange, /verifyPassword/)
})
