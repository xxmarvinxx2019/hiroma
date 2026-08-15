import assert from 'node:assert/strict'
import test from 'node:test'
import { isAccountSessionCurrent } from '../src/app/lib/accountSession'
import { readFileSync } from 'node:fs'

test('multiple sessions issued after the same password change remain valid', () => {
  const changedAt = new Date('2026-08-12T10:00:00.000Z')
  const laptop = { session_epoch: changedAt.getTime() }
  const phone = { session_epoch: changedAt.getTime() }
  assert.equal(isAccountSessionCurrent(laptop, changedAt), true)
  assert.equal(isAccountSessionCurrent(phone, changedAt), true)
})

test('a password change invalidates every token issued under the previous epoch', () => {
  const oldChangedAt = new Date('2026-08-12T10:00:00.000Z')
  const newChangedAt = new Date('2026-08-12T11:00:00.000Z')
  assert.equal(isAccountSessionCurrent({ session_epoch: oldChangedAt.getTime() }, newChangedAt), false)
  assert.equal(isAccountSessionCurrent({ session_epoch: newChangedAt.getTime() }, newChangedAt), true)
})

test('legacy accounts remain usable until their first secured password change', () => {
  assert.equal(isAccountSessionCurrent({}, null), true)
  assert.equal(isAccountSessionCurrent({}, new Date('2026-08-12T11:00:00.000Z')), false)
})

test('security PIN completion rechecks account revocation and password epoch', () => {
  const route = readFileSync('src/app/api/auth/login/pin/route.ts', 'utf8')
  assert.match(route, /login_disabled: true/)
  assert.match(route, /user\.login_disabled/)
  assert.match(route, /isAccountSessionCurrent\(challenge, user\.password_changed_at\)/)
})
