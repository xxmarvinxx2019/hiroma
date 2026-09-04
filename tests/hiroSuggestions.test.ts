import test from 'node:test'
import assert from 'node:assert/strict'
import { getHiroSuggestions } from '../src/app/lib/hiroSuggestions'

test('returns four varied suggestions for a new conversation', () => {
  const first = getHiroSuggestions([], 'conversation-a')
  const second = getHiroSuggestions([], 'conversation-b')
  assert.equal(first.length, 4)
  assert.equal(new Set(first).size, 4)
  assert.notDeepEqual(first, second)
})

test('recommends follow-up questions related to the latest Hiro intent', () => {
  const suggestions = getHiroSuggestions([
    { role: 'user', text: 'how much my balance' },
    { role: 'hiro', text: 'Your balance is available.', intent: 'wallet' },
  ], 'wallet-chat')
  const walletFollowUps = ['What is my total earned?', 'What is my total withdrawn?', 'Do I have a pending payout?', 'How do I request a payout?']
  assert.equal(suggestions.filter((suggestion) => walletFollowUps.includes(suggestion)).length, 2)
})

test('keeps discovery suggestions separate from the selected intent follow-ups', () => {
  const walletFollowUps = ['What is my total earned?', 'What is my total withdrawn?', 'Do I have a pending payout?', 'How do I request a payout?']

  for (let index = 0; index < 100; index += 1) {
    const suggestions = getHiroSuggestions([
      { role: 'user', text: 'how much my balance' },
      { role: 'hiro', text: 'Your balance is available.', intent: 'wallet' },
    ], `wallet-chat-${index}`)

    assert.equal(suggestions.filter((suggestion) => walletFollowUps.includes(suggestion)).length, 2)
  }
})

test('changes discovery recommendations as the conversation changes', () => {
  const initial = getHiroSuggestions([], 'same-chat')
  const afterProduct = getHiroSuggestions([
    { role: 'user', text: 'available perfume' },
    { role: 'hiro', text: 'Here are the products.', intent: 'products' },
  ], 'same-chat')
  assert.notDeepEqual(initial, afterProduct)
  assert.ok(afterProduct.some((suggestion) => suggestion.includes('reseller price') || suggestion.includes('perfumes')))
})

test('uses English by default and follows explicit language requests', () => {
  assert.ok(getHiroSuggestions([], 'english-default').every((suggestion) => !suggestion.startsWith('Pila ')))
  const tagalog = getHiroSuggestions([{ role: 'user', text: 'Tagalog please' }], 'tagalog-chat')
  assert.ok(tagalog.some((suggestion) => /Ano|Magkano|Paano|Ilan|May/.test(suggestion)))
})

test('prioritizes verified account-aware questions and changes with account context', () => {
  const accountQuestions = [
    'Why should I focus on my Right Team today?',
    'Is my wallet payout-ready?',
    'Which Learning Center lesson should I take today?',
  ]
  const first = getHiroSuggestions([], 'account-chat', accountQuestions, 'right-gap:22:wallet:20465')
  const changed = getHiroSuggestions([], 'account-chat', accountQuestions, 'right-gap:4:wallet:900')
  assert.equal(first.filter((suggestion) => accountQuestions.includes(suggestion)).length, 2)
  assert.notDeepEqual(first, changed)
})
