import { createHash, randomBytes } from 'crypto'

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000

export function createPasswordResetToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashPasswordResetToken(token) }
}

export function hashPasswordResetToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function escapeEmailHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character))
}
