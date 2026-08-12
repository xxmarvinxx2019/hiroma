import test from 'node:test'
import assert from 'node:assert/strict'
import { canTransitionSupportTicketStatus } from '../src/app/lib/supportStatusPolicy'

test('open and in-progress tickets may follow the normal support workflow', () => {
  assert.equal(canTransitionSupportTicketStatus('new', 'reviewing'), true)
  assert.equal(canTransitionSupportTicketStatus('reviewing', 'resolved'), true)
})

test('a resolved ticket can never return to open or in progress', () => {
  assert.equal(canTransitionSupportTicketStatus('resolved', 'new'), false)
  assert.equal(canTransitionSupportTicketStatus('resolved', 'reviewing'), false)
  assert.equal(canTransitionSupportTicketStatus('resolved', 'resolved'), true)
})
