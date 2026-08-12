import { createHmac, randomInt, randomUUID } from 'node:crypto'

export const SUPPORT_CAPTCHA_TTL_MS = 3 * 60 * 1000
export const SUPPORT_RATE_WINDOW_MS = 15 * 60 * 1000
export const SUPPORT_ANONYMOUS_WINDOW_LIMIT = 3
export const SUPPORT_ANONYMOUS_DAILY_EMAIL_LIMIT = 5
export const SUPPORT_MEMBER_WINDOW_LIMIT = 5
export const SUPPORT_GLOBAL_WINDOW_LIMIT = 100

function secret() {
  const value = process.env.SUPPORT_CAPTCHA_SECRET || process.env.JWT_SECRET
  if (!value || value.length < 32) throw new Error('SUPPORT_CAPTCHA_SECRET or JWT_SECRET must contain at least 32 characters.')
  return value
}

function digest(namespace: string, value: string) {
  return createHmac('sha256', secret()).update(`${namespace}:${value}`).digest('hex')
}

export function createSupportCaptcha() {
  const left = randomInt(1, 10)
  const right = randomInt(1, 10)
  const id = randomUUID()
  return {
    id,
    question: `${left} + ${right} = ?`,
    answerDigest: digest('support-captcha-answer', `${id}:${left + right}`),
    expiresAt: new Date(Date.now() + SUPPORT_CAPTCHA_TTL_MS),
  }
}

export function supportCaptchaAnswerDigest(id: string, answer: unknown) {
  const normalized = typeof answer === 'string' ? answer.trim() : ''
  return normalized ? digest('support-captcha-answer', `${id}:${normalized}`) : ''
}

export function supportClientFingerprint(ip: string, now = new Date()) {
  const day = now.toISOString().slice(0, 10)
  return digest('support-client', `${day}:${ip}`)
}

export function supportEmailFingerprint(email: string) {
  return digest('support-email', email.trim().toLowerCase())
}

export function getSupportClientAddress(headers: Headers) {
  const vercel = headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
  const real = headers.get('x-real-ip')?.trim()
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (vercel || real || forwarded || 'unknown').slice(0, 100)
}
