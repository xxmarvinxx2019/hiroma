import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const adminRoute = readFileSync(new URL('../src/app/api/admin/settings/profile/route.ts', import.meta.url), 'utf8')
const adminPage = readFileSync(new URL('../src/app/dashboard/admin/settings/page.tsx', import.meta.url), 'utf8')
const regionalRoute = readFileSync(new URL('../src/app/api/regional/profile/route.ts', import.meta.url), 'utf8')
const provincialRoute = readFileSync(new URL('../src/app/api/provincial/profile/route.ts', import.meta.url), 'utf8')

test('admin sensitive profile updates require the configured Security PIN', () => {
  assert.match(adminRoute, /verifyResellerSecurityPin\(user\.id, security_pin\)/)
  assert.match(adminRoute, /isSensitiveResellerPinAccepted\(pinVerification\)/)
  assert.match(adminRoute, /sensitive_profile_updated/)
  assert.match(adminPage, /security_pin: profileSecurityPin/)
  assert.match(adminPage, /Enter your six-digit PIN to confirm/)
})

test('regional and provincial self-service routes allow address only', () => {
  for (const route of [regionalRoute, provincialRoute]) {
    assert.match(route, /\['full_name', 'email', 'mobile'\]/)
    assert.match(route, /status: 403/)
    assert.match(route, /data: \{\s*address:/)
    assert.doesNotMatch(route, /full_name: full_name\.trim\(\)/)
    assert.doesNotMatch(route, /email:\s+email\?\.trim/)
    assert.doesNotMatch(route, /mobile:\s+mobile\.trim/)
  }
})
