import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const route = readFileSync('src/app/api/admin/distributors/route.ts', 'utf8')
const page = readFileSync('src/app/dashboard/admin/distributors/page.tsx', 'utf8')

test('delegated distributor-management staff cannot reset distributor credentials', () => {
  const resetBranch = route.slice(route.indexOf("if (action === 'reset_password')"), route.indexOf('// ── Edit profile'))
  assert.match(resetBranch, /if \(user\.is_staff\)/)
  assert.match(resetBranch, /Only the admin owner can reset distributor passwords/)
})

test('owner reset requires PIN and atomically revokes sessions and passkeys', () => {
  assert.match(route, /verifyResellerSecurityPin\(user\.id, security_pin\)/)
  assert.match(route, /prisma\.\$transaction\(async \(tx\) =>/)
  assert.match(route, /password_changed_at: new Date\(\)/)
  assert.match(route, /tx\.passkeyCredential\.deleteMany/)
  assert.match(route, /distributor_password_reset/)
})

test('admin UI confirms the destructive credential action with a Security PIN', () => {
  assert.match(page, /Admin Security PIN/)
  assert.match(page, /security_pin: resetSecurityPin/)
  assert.match(page, /removes registered passkeys/)
})

test('only the owner with a Security PIN can change distributor recovery contacts', () => {
  const editBranch = route.slice(route.indexOf("if (action === 'edit')"), route.indexOf('// ── Assign parent'))
  assert.match(editBranch, /changesSensitiveContact/)
  assert.match(editBranch, /if \(user\.is_staff\)/)
  assert.match(editBranch, /verifyResellerSecurityPin\(user\.id, body\.security_pin\)/)
  assert.match(page, /security_pin: editSecurityPin/)
})

test('sensitive edit PIN is requested contextually instead of living in the list toolbar', () => {
  const toolbar = page.slice(page.indexOf('{/* Search & Filter */}'), page.indexOf('{/* Table Header */}'))
  assert.doesNotMatch(toolbar, /Admin Security PIN/)
  assert.match(page, /changesSensitiveContact && editSecurityPin\.length !== 6/)
  assert.match(page, /Confirm sensitive changes/)
  assert.match(page, /editPinPromptOpen/)
  assert.match(page, /Confirm & save/)
  assert.match(page, /setEditSecurityPin\(''\)/)
})
