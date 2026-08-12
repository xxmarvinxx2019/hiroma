import test from 'node:test'
import assert from 'node:assert/strict'
import { detectHiroLanguage, isLanguageRequest, isTicketConfirmation } from '../src/app/lib/hiroLanguage'

test('defaults to English and recognizes explicit language changes', () => {
  assert.equal(detectHiroLanguage('balance'), 'en')
  assert.equal(detectHiroLanguage('Tagalog please'), 'tl')
  assert.equal(detectHiroLanguage('Bisaya please'), 'ceb')
  assert.equal(isLanguageRequest('English please'), true)
  assert.equal(detectHiroLanguage('How much is my wallet balance?', 'ceb'), 'en')
  assert.equal(detectHiroLanguage('Magkano ang balance ko?', 'en'), 'tl')
  assert.equal(detectHiroLanguage('Pila akong wallet balance?', 'en'), 'ceb')
})

test('recognizes multilingual support ticket consent', () => {
  assert.equal(isTicketConfirmation('Yes please'), true)
  assert.equal(isTicketConfirmation('Oo'), true)
  assert.equal(isTicketConfirmation('Dili'), false)
  assert.equal(isTicketConfirmation('tell me more'), null)
})
