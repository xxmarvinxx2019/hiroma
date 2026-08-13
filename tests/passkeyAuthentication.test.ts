import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  getPasskeyAuthenticationUserId,
  getPasskeyResponseDelay,
  isRealPasskeyChallenge,
} from '../src/app/lib/passkeyAuthentication'

const eligible = {
  id: 'reseller-1',
  role: 'reseller',
  status: 'active',
  login_disabled: false,
  passkey_credentials: [{}],
}

test('only an enrolled active eligible account receives a user-bound challenge', () => {
  assert.equal(getPasskeyAuthenticationUserId(eligible), 'reseller-1')
  assert.equal(getPasskeyAuthenticationUserId({ ...eligible, role: 'city' }), 'reseller-1')
  assert.equal(getPasskeyAuthenticationUserId(null), null)
  assert.equal(getPasskeyAuthenticationUserId({ ...eligible, role: 'admin' }), 'reseller-1')
  assert.equal(getPasskeyAuthenticationUserId({ ...eligible, login_disabled: true }), null)
  assert.equal(getPasskeyAuthenticationUserId({ ...eligible, status: 'suspended' }), null)
  assert.equal(getPasskeyAuthenticationUserId({ ...eligible, passkey_credentials: [] }), null)
})

test('decoy challenges can never authenticate an account', () => {
  assert.equal(isRealPasskeyChallenge(null), false)
  assert.equal(isRealPasskeyChallenge(undefined), false)
  assert.equal(isRealPasskeyChallenge(''), false)
  assert.equal(isRealPasskeyChallenge('reseller-1'), true)
})

test('response timing is normalized within a small bounded window', () => {
  assert.equal(getPasskeyResponseDelay(1_000, 1_000, 0), 250)
  assert.equal(getPasskeyResponseDelay(1_000, 1_000, 1), 300)
  assert.equal(getPasskeyResponseDelay(1_000, 1_200, 0.5), 75)
  assert.equal(getPasskeyResponseDelay(1_000, 1_500, 0.5), 0)
  assert.equal(getPasskeyResponseDelay(1_000, 900, 1), 300)
  assert.equal(getPasskeyResponseDelay(Number.NaN, 1_000, 1), 300)
  assert.equal(getPasskeyResponseDelay(1_000, Number.POSITIVE_INFINITY, Number.NaN), 250)
})

test('authentication options use one indistinguishable discoverable-credential shape', () => {
  const source = readFileSync(
    new URL('../src/app/api/auth/passkey/authenticate/options/route.ts', import.meta.url),
    'utf8',
  )
  assert.equal((source.match(/const options = await generateAuthenticationOptions/g) || []).length, 1)
  assert.doesNotMatch(source, /allowCredentials/)
  assert.match(source, /userVerification:\s*'required'/)
  assert.match(source, /issuePasskeyChallenge\(challengeUserId, options\.challenge/)
  assert.match(source, /NextResponse\.json\(options\)/)
  assert.match(source, /const startedAt = performance\.now\(\)/)
  assert.doesNotMatch(source, /Date\.now\(\)/)
})
