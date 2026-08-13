import test from 'node:test'
import assert from 'node:assert/strict'
import { HIRO_INACTIVITY_MS } from '../src/app/lib/hiroConversation'
import { getHiroRetentionCutoffs, HIRO_CHAT_RETENTION_MS } from '../src/app/lib/hiroRetention'

test('closed Hiro chats expire seven days after their last activity', () => {
  const now = Date.parse('2026-08-10T00:00:00.000Z')
  const cutoffs = getHiroRetentionCutoffs(now)
  assert.equal(cutoffs.closedBefore.getTime(), now - HIRO_CHAT_RETENTION_MS)
})

test('abandoned active chats include the five-minute close window before retention', () => {
  const now = Date.parse('2026-08-10T00:00:00.000Z')
  const cutoffs = getHiroRetentionCutoffs(now)
  assert.equal(cutoffs.abandonedBefore.getTime(), now - HIRO_CHAT_RETENTION_MS - HIRO_INACTIVITY_MS)
})
