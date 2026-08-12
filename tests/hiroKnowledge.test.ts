import test from 'node:test'
import assert from 'node:assert/strict'
import { answerHiroQuestion, type HiroAccountContext } from '../src/app/lib/hiroKnowledge'

const account: HiroAccountContext = {
  fullName: 'Test Member', username: 'member01', memberId: 'HRM0001', packageName: 'Starter', rank: 'Builder', points: 120,
  walletBalance: 1500, totalEarned: 2500, totalWithdrawn: 1000, orderCounts: { total: 3, pending: 1, delivered: 2 },
  pendingPayouts: 1, openTickets: 2,
  leftNetworkCount: 51, rightNetworkCount: 29,
  products: [
    { name: 'Hiroma Poseidon 200ml', description: 'Long-lasting oil-rich fragrance.', type: 'physical', srp: 249, resellerPrice: 183 },
    { name: 'Hiroma Clio 200ml', description: 'A signature Hiroma fragrance.', type: 'physical', srp: 249, resellerPrice: 183 },
  ],
}

test('answers live wallet questions in Bisaya', () => {
  const reply = answerHiroQuestion('Pila akong kwarta sa wallet?', account)
  assert.equal(reply.matchedIntent, 'wallet')
  assert.match(reply.answer, /1,500/)
})

test('answers natural English wallet questions', () => {
  const reply = answerHiroQuestion('how much my balance', account)
  assert.equal(reply.matchedIntent, 'wallet')
  assert.match(reply.answer, /1,500/)
})

test('explicit wallet question overrides a previous Learning Center topic', () => {
  const reply = answerHiroQuestion('how much my balance', account, { previousIntent: 'learning' })
  assert.equal(reply.matchedIntent, 'wallet')
  assert.match(reply.answer, /1,500/)
})

test('understands Tagalog wallet questions', () => {
  const reply = answerHiroQuestion('Magkano ang balance ko?', account)
  assert.equal(reply.matchedIntent, 'wallet')
})

test('understands another Bisaya wallet phrasing', () => {
  const reply = answerHiroQuestion('Pila ang akong balanse?', account)
  assert.equal(reply.matchedIntent, 'wallet')
})

test('explicit order question overrides a previous wallet topic', () => {
  const reply = answerHiroQuestion('Where is my order?', account, { previousIntent: 'wallet' })
  assert.equal(reply.matchedIntent, 'orders')
})

test('answers left-leg count from authorized reseller network data', () => {
  const reply = answerHiroQuestion('pila akong left leg', account, { previousIntent: 'wallet' })
  assert.equal(reply.matchedIntent, 'network-stats')
  assert.match(reply.answer, /51 members.*left leg/)
  assert.match(reply.answer, /29.*right leg/)
})

test('answers English right-network count questions', () => {
  const reply = answerHiroQuestion('How many in my right network?', account)
  assert.equal(reply.matchedIntent, 'network-stats')
  assert.match(reply.answer, /29.*right leg/)
})

test('matches Tagalog order questions', () => {
  const reply = answerHiroQuestion('Nasaan na ang pending order ko?', account)
  assert.equal(reply.matchedIntent, 'orders')
  assert.match(reply.answer, /1 pending/)
})

test('does not invent an answer for unknown topics', () => {
  const reply = answerHiroQuestion('What is the weather on Mars?', account)
  assert.equal(reply.matchedIntent, 'fallback')
  assert.ok(reply.links.some((link) => link.href.includes('support-center')))
})

test('responds naturally to casual conversation', () => {
  const reply = answerHiroQuestion('mao ba?', account)
  assert.equal(reply.matchedIntent, 'conversation')
  assert.match(reply.answer, /sunod nga pangutana/i)
})

test('uses the previous intent for a short follow-up', () => {
  const reply = answerHiroQuestion('pila gani?', account, { previousIntent: 'wallet' })
  assert.equal(reply.matchedIntent, 'wallet')
  assert.match(reply.answer, /1,500/)
})

test('asks a friendly clarification for an unknown question', () => {
  const reply = answerHiroQuestion('blorptastic', account)
  assert.equal(reply.matchedIntent, 'fallback')
  assert.match(reply.answer, /support ticket/i)
})

test('answers the current price of a specific live-catalog perfume', () => {
  const reply = answerHiroQuestion('Pila ang price sa Poseidon perfume?', account)
  assert.equal(reply.matchedIntent, 'products')
  assert.match(reply.answer, /Poseidon/)
  assert.match(reply.answer, /249/)
  assert.match(reply.answer, /183/)
})

test('lists live products for a generic perfume question', () => {
  const reply = answerHiroQuestion('Unsa inyong available perfumes?', account)
  assert.equal(reply.matchedIntent, 'products')
  assert.match(reply.answer, /Poseidon/)
  assert.match(reply.answer, /Clio/)
})

test('explains what Hiroma is', () => {
  const reply = answerHiroQuestion('Unsa ning Hiroma?', account)
  assert.equal(reply.matchedIntent, 'company')
  assert.match(reply.answer, /product distribution/i)
})

test('explains direct referral without inventing an unconfigured amount', () => {
  const reply = answerHiroQuestion('Unsaon pag-work sa direct referral bonus?', account)
  assert.equal(reply.matchedIntent, 'direct-referral')
  assert.match(reply.answer, /configured package rules/i)
})

test('explains member QR without exposing sensitive credentials', () => {
  const reply = answerHiroQuestion('Para asa ang member QR sa Digital ID?', account)
  assert.equal(reply.matchedIntent, 'digital-id')
  assert.doesNotMatch(reply.answer, /complete account number/i)
  assert.match(reply.answer, /verify/i)
})

test('explains reseller and non-member pricing', () => {
  const reply = answerHiroQuestion('Unsa difference sa SRP ug reseller price?', account)
  assert.equal(reply.matchedIntent, 'pricing')
  assert.match(reply.answer, /non-member/i)
})
