import test from 'node:test'
import assert from 'node:assert/strict'
import { getSupportTicketRetentionCutoff, SUPPORT_TICKET_RETENTION_MS } from '../src/app/lib/supportRetentionPolicy'

test('resolved support tickets expire thirty days after their latest update', () => {
  const now = Date.parse('2026-08-10T00:00:00.000Z')
  assert.equal(getSupportTicketRetentionCutoff(now).getTime(), now - SUPPORT_TICKET_RETENTION_MS)
})
