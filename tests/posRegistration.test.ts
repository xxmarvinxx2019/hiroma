import assert from 'node:assert/strict'
import test from 'node:test'
import { canTransitionRegistration } from '../src/app/lib/posRegistration'

test('non-cash registration cannot release before payment verification', () => {
  assert.equal(canTransitionRegistration('pending_payment_verification', 'released_pending_encoding'), false)
  assert.equal(canTransitionRegistration('pending_payment_verification', 'payment_verified_ready_for_release'), true)
})

test('released registration moves to encoding but never back to payment', () => {
  assert.equal(canTransitionRegistration('released_pending_encoding', 'encoding_in_progress'), true)
  assert.equal(canTransitionRegistration('released_pending_encoding', 'pending_payment_verification'), false)
})

test('completed registration is terminal', () => {
  assert.equal(canTransitionRegistration('registration_completed', 'encoding_in_progress'), false)
  assert.equal(canTransitionRegistration('registration_completed', 'released_pending_encoding'), false)
})
