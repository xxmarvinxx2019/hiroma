const PASSKEY_UNAVAILABLE_MESSAGE = 'Face ID / fingerprint is not available on this device or the request was cancelled. Sign in with your password, then register this device in Security Settings.'
const PASSKEY_UNSUPPORTED_MESSAGE = 'Face ID / fingerprint is not supported in this browser or connection. Use an updated browser over HTTPS, or sign in with your password.'
const PASSKEY_FAILED_MESSAGE = 'Face ID / fingerprint sign-in could not be completed. Use your password or try again.'

export function getPasskeySignInError(error: unknown) {
  const name = error instanceof Error ? error.name : ''

  if (name === 'NotAllowedError' || name === 'AbortError') return PASSKEY_UNAVAILABLE_MESSAGE
  if (name === 'NotSupportedError' || name === 'SecurityError') return PASSKEY_UNSUPPORTED_MESSAGE
  return PASSKEY_FAILED_MESSAGE
}
