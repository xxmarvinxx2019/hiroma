import assert from 'node:assert/strict'
import test from 'node:test'
import { getPasskeySignInError } from '../src/app/lib/passkeyError'

test('normalizes unavailable, cancelled, and denied passkey requests', () => {
  for (const name of ['NotAllowedError', 'AbortError']) {
    const error = new Error('Browser-specific details must not be shown.')
    error.name = name
    assert.match(getPasskeySignInError(error), /not available on this device or the request was cancelled/i)
  }
})

test('provides a safe browser compatibility message', () => {
  for (const name of ['NotSupportedError', 'SecurityError']) {
    const error = new Error('Internal browser message')
    error.name = name
    assert.match(getPasskeySignInError(error), /not supported in this browser or connection/i)
  }
})

test('does not expose unexpected browser or server error details', () => {
  assert.equal(
    getPasskeySignInError(new Error('Sensitive implementation detail')),
    'Face ID / fingerprint sign-in could not be completed. Use your password or try again.',
  )
})
