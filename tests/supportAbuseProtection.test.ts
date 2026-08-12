import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  createSupportCaptcha,
  supportCaptchaAnswerDigest,
  supportClientFingerprint,
  supportEmailFingerprint,
} from '../src/app/lib/supportAbuseProtection'

process.env.SUPPORT_CAPTCHA_SECRET = 'test-only-support-captcha-secret-32-characters'

const root = process.cwd()
const route = fs.readFileSync(path.join(root, 'src/app/api/public/support-requests/route.ts'), 'utf8')
const captchaRoute = fs.readFileSync(path.join(root, 'src/app/api/public/support-captcha/route.ts'), 'utf8')

test('captcha answers are challenge-bound and are not stored in plaintext', () => {
  const challenge = createSupportCaptcha()
  const expected = Number(challenge.question.split(' ')[0]) + Number(challenge.question.split(' ')[2])
  assert.equal(supportCaptchaAnswerDigest(challenge.id, String(expected)), challenge.answerDigest)
  assert.notEqual(supportCaptchaAnswerDigest(challenge.id, String(expected + 1)), challenge.answerDigest)
  assert.doesNotMatch(captchaRoute, /answer:\s*challenge/)
})

test('client fingerprints rotate daily and email fingerprints normalize case', () => {
  assert.notEqual(
    supportClientFingerprint('203.0.113.10', new Date('2026-08-12T00:00:00Z')),
    supportClientFingerprint('203.0.113.10', new Date('2026-08-13T00:00:00Z')),
  )
  assert.equal(supportEmailFingerprint(' USER@example.com '), supportEmailFingerprint('user@example.com'))
})

test('anonymous captcha is consumed atomically before durable ticket creation', () => {
  const consume = route.indexOf('supportCaptchaChallenge.updateMany')
  const create = route.indexOf('tx.supportRequest.create')
  assert.ok(consume > 0 && create > consume)
  assert.match(route, /used_at:\s*null/)
  assert.match(route, /expires_at:\s*\{ gt: now \}/)
  assert.match(route, /if \(consumed\.count !== 1\) throw new SupportCaptchaError/)
})

test('submission quotas are checked before ticket and screenshot persistence', () => {
  assert.match(route, /globalRecent >= SUPPORT_GLOBAL_WINDOW_LIMIT/)
  assert.match(route, /submitterRecent >= submitterLimit/)
  assert.match(route, /emailToday >= SUPPORT_ANONYMOUS_DAILY_EMAIL_LIMIT/)
  assert.ok(route.indexOf('throw new SupportSubmissionLimitError') < route.indexOf('tx.supportRequest.create'))
  assert.ok(route.indexOf('tx.supportRequest.create') < route.indexOf('await uploadSupportScreenshot'))
})

test('logged-in reseller submissions preserve the no-captcha path with an account quota', () => {
  assert.match(route, /if \(!isMember\) \{/)
  assert.match(route, /isMember\s*\? \{ user_id: currentUser\.id/)
  assert.match(route, /SUPPORT_MEMBER_WINDOW_LIMIT/)
})
