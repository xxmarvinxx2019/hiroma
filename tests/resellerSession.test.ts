import test from 'node:test'
import assert from 'node:assert/strict'
import { isResellerSessionCurrent } from '../src/app/lib/resellerSession'

const changedAt = new Date('2026-08-09T08:00:00.123Z')

test('password recovery invalidates reseller sessions issued under the prior epoch', () => {
  assert.equal(isResellerSessionCurrent({ role: 'reseller', session_epoch: changedAt.getTime() - 1 }, changedAt), false)
  assert.equal(isResellerSessionCurrent({ role: 'reseller' }, changedAt), false)
})

test('a reseller session issued after recovery remains valid', () => {
  assert.equal(isResellerSessionCurrent({ role: 'reseller', session_epoch: changedAt.getTime() }, changedAt), true)
})

test('admin and distributor session behavior is unchanged', () => {
  assert.equal(isResellerSessionCurrent({ role: 'admin' }, changedAt), true)
  assert.equal(isResellerSessionCurrent({ role: 'city' }, changedAt), true)
})

test('reseller accounts without a password-change epoch keep existing sessions', () => {
  assert.equal(isResellerSessionCurrent({ role: 'reseller' }, null), true)
})
