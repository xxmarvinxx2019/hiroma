import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const editRoute = readFileSync('src/app/api/admin/resellers/[id]/route.ts', 'utf8')
const resetRoute = readFileSync('src/app/api/admin/resellers/[id]/password-reset/route.ts', 'utf8')

test('delegated staff cannot change reseller credentials or recovery contacts', () => {
  assert.match(editRoute, /if \(user\.is_staff && protectedFields\.length > 0\)/)
  assert.match(editRoute, /Only the admin owner can change reseller username, email, or mobile/)
  assert.doesNotMatch(editRoute, /hashPassword/)
  assert.doesNotMatch(editRoute, /password_hash/)
  assert.match(resetRoute, /admin\.is_staff/)
})

test('owner sensitive changes require PIN, invalidate sessions, and create audit evidence', () => {
  assert.match(editRoute, /verifyResellerSecurityPin\(user\.id, security_pin\)/)
  assert.match(editRoute, /password_changed_at: new Date\(\)/)
  assert.match(editRoute, /reseller_sensitive_profile_updated/)
  assert.match(resetRoute, /verifyResellerSecurityPin\(admin\.id, security_pin\)/)
  assert.match(resetRoute, /reseller_password_reset_requested/)
})

test('ordinary reseller profile maintenance remains available', () => {
  assert.match(editRoute, /full_name: full_name\.trim\(\)/)
  assert.match(editRoute, /address: cleanAddress/)
  assert.match(editRoute, /select: \{ id: true, full_name: true, username: true, email: true, mobile: true, address: true \}/)
})
