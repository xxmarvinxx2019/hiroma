import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/app/api/auth/passkey/register/options/route.ts', import.meta.url),
  'utf8',
)

test('registration requires a discoverable credential and user verification', () => {
  assert.match(source, /residentKey:\s*'required'/)
  assert.match(source, /requireResidentKey:\s*true/)
  assert.match(source, /userVerification:\s*'required'/)
  assert.doesNotMatch(source, /residentKey:\s*'preferred'/)
})

test('registration preserves password confirmation and multi-device exclusions', () => {
  assert.match(source, /verifyPassword\(body\.password/)
  assert.match(source, /isPasskeyEligible\(account\)/)
  assert.match(source, /excludeCredentials:\s*account!\.passkey_credentials\.map/)
  assert.match(source, /issuePasskeyChallenge\(account!\.id, options\.challenge, 'register', deviceName\)/)
})
