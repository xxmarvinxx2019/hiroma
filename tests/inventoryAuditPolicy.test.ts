import assert from 'node:assert/strict'
import test from 'node:test'
import { canLocalAccountCount, canLocalOwnerReview } from '../src/app/lib/inventoryAuditPolicy'

test('only local staff can count ordinary local audits', () => {
  assert.equal(canLocalAccountCount(true, 'inventory'), true)
  assert.equal(canLocalAccountCount(false, null), false)
  assert.equal(canLocalAccountCount(true, 'area_manager'), false)
})

test('local owner can review a different actor submission', () => {
  assert.equal(canLocalOwnerReview({ isAuthorizedApprover: true, status: 'submitted', submitterId: 'staff-1', starterId: 'staff-1', actorId: 'owner-1' }), true)
})

test('self approval and unauthorized staff approval are rejected', () => {
  assert.equal(canLocalOwnerReview({ isAuthorizedApprover: true, status: 'submitted', submitterId: 'owner-1', starterId: 'owner-1', actorId: 'owner-1' }), false)
  assert.equal(canLocalOwnerReview({ isAuthorizedApprover: false, status: 'submitted', submitterId: 'staff-1', starterId: 'staff-1', actorId: 'staff-2' }), false)
  assert.equal(canLocalOwnerReview({ isAuthorizedApprover: true, status: 'submitted', submitterId: 'staff-1', starterId: 'staff-1', actorId: 'approver-1' }), true)
})

test('legacy sessions fall back to starter identity for self-review prevention', () => {
  assert.equal(canLocalOwnerReview({ isAuthorizedApprover: true, status: 'submitted', submitterId: null, starterId: 'owner-1', actorId: 'owner-1' }), false)
})
