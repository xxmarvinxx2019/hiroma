import test from 'node:test'
import assert from 'node:assert/strict'
import { HIRO_INACTIVITY_MS, isHiroCloseRequest, isHiroConversationInactive } from '../src/app/lib/hiroConversation'

const now = new Date('2026-08-10T12:00:00.000Z').getTime()

test('keeps a Hiro conversation active before five minutes', () => {
  assert.equal(isHiroConversationInactive(new Date(now - HIRO_INACTIVITY_MS + 1), now), false)
})

test('closes a Hiro conversation at five minutes of inactivity', () => {
  assert.equal(isHiroConversationInactive(new Date(now - HIRO_INACTIVITY_MS), now), true)
})

test('closes a Hiro conversation after more than five minutes', () => {
  assert.equal(isHiroConversationInactive(new Date(now - HIRO_INACTIVITY_MS - 60_000), now), true)
})

test('recognizes conversational requests to end a Hiro chat', () => {
  for (const message of ['close convo', 'close conco', 'Please close this conversation.', 'end chat', 'human na', 'tapos na', 'salamat bye', 'goodbye']) {
    assert.equal(isHiroCloseRequest(message), true, message)
  }
})

test('does not close for unrelated uses of close or ordinary questions', () => {
  for (const message of ['what time does the store close?', 'close ba ang payout?', 'pila akong balance?', 'thank you for the information about payouts']) {
    assert.equal(isHiroCloseRequest(message), false, message)
  }
})
