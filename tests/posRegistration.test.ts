import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { canTransitionRegistration } from '../src/app/lib/posRegistration'

const read = (path: string) => readFileSync(path, 'utf8')

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

test('returned registration payments notify the exact cashier and support correction resubmission', () => {
  const approvals = read('src/app/api/city/pos/registration-approvals/route.ts')
  const registrations = read('src/app/api/city/pos/registrations/route.ts')
  const page = read('src/app/dashboard/city/pos/registrations/page.tsx')

  assert.match(approvals, /needs_correction/)
  assert.match(approvals, /pos_registration_needs_correction/)
  assert.match(approvals, /user_id:\s*row\.cashier_id/)
  assert.match(registrations, /export async function PATCH/)
  assert.match(registrations, /cashier_id:\s*actorId/)
  assert.match(registrations, /status:\s*["']needs_correction["']/)
  assert.match(registrations, /pending_payment_verification/)
  assert.match(registrations, /payment_correction_resubmitted/)
  assert.match(page, /Returned by the manager/)
  assert.match(page, /Correct official payment reference/)
  assert.match(page, /Resubmit for payment review/)
})
