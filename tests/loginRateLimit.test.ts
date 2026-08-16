import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  LOGIN_ACCOUNT_WINDOW_LIMIT,
  LOGIN_IP_WINDOW_LIMIT,
  loginRateLimitDecision,
  normalizeLoginIdentifier,
} from '../src/app/lib/loginRateLimitPolicy'

test('login identifiers are normalized consistently', () => {
  assert.equal(normalizeLoginIdentifier('  NoelA1  '), 'noela1')
})

test('normal login traffic remains allowed', () => {
  assert.deepEqual(loginRateLimitDecision(1, 1), { allowed: true, retryAfterSeconds: 0 })
  assert.equal(loginRateLimitDecision(LOGIN_IP_WINDOW_LIMIT, LOGIN_ACCOUNT_WINDOW_LIMIT).allowed, true)
})

test('excessive IP and account attempts receive temporary cooldowns', () => {
  assert.deepEqual(loginRateLimitDecision(LOGIN_IP_WINDOW_LIMIT + 1, 1), { allowed: false, retryAfterSeconds: 300 })
  assert.deepEqual(loginRateLimitDecision(1, LOGIN_ACCOUNT_WINDOW_LIMIT + 1), { allowed: false, retryAfterSeconds: 900 })
})

test('login route consumes allowance before password verification and resets only after valid password', () => {
  const route = readFileSync(new URL('../src/app/api/auth/login/route.ts', import.meta.url), 'utf8')
  const consumeIndex = route.indexOf('consumeLoginAllowance(req.headers, normalizedUsername)')
  const lookupIndex = route.indexOf('prisma.user.findUnique')
  const passwordIndex = route.indexOf('verifyPassword(password, user.password_hash)')
  const statusIndex = route.indexOf("user.status !== 'active'")
  assert.ok(consumeIndex >= 0 && consumeIndex < lookupIndex)
  assert.ok(passwordIndex >= 0 && passwordIndex < statusIndex)
  assert.match(route, /status: 429/)
  assert.match(route, /'Retry-After'/)
  assert.match(route, /verifyPassword\(password, LOGIN_TIMING_DECOY_HASH\)/)
  assert.match(route, /resetLoginAccountFailures\(normalizedUsername\)/)
})

test('migration and helper enforce atomic shared counters', () => {
  const migration = readFileSync(new URL('../prisma/migrations/20260813170000_add_login_rate_limits/migration.sql', import.meta.url), 'utf8')
  const helper = readFileSync(new URL('../src/app/lib/loginRateLimit.ts', import.meta.url), 'utf8')
  assert.match(migration, /PRIMARY KEY \("bucket_key", "window_start"\)/)
  assert.match(helper, /ON CONFLICT \(bucket_key, window_start\) DO UPDATE/)
  assert.match(helper, /request_count = LEAST\(login_rate_limits\.request_count \+ 1, 1001\)/)
  assert.match(helper, /createHmac\('sha256'/)
})
