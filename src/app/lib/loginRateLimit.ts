import { createHmac } from 'node:crypto'
import { Prisma } from '@prisma/client'
import prisma from '@/app/lib/prisma'
import { getSupportClientAddress } from '@/app/lib/supportAbuseProtection'
import {
  LOGIN_ACCOUNT_WINDOW_LIMIT,
  LOGIN_ACCOUNT_WINDOW_MINUTES,
  LOGIN_IP_WINDOW_LIMIT,
  LOGIN_IP_WINDOW_MINUTES,
  loginRateLimitDecision,
  normalizeLoginIdentifier,
} from '@/app/lib/loginRateLimitPolicy'

function limiterSecret() {
  const value = process.env.LOGIN_RATE_LIMIT_SECRET || process.env.JWT_SECRET
  if (!value || value.length < 32) throw new Error('LOGIN_RATE_LIMIT_SECRET or JWT_SECRET must contain at least 32 characters.')
  return value
}

function bucketKey(namespace: 'ip' | 'account', value: string) {
  return `${namespace}:${createHmac('sha256', limiterSecret()).update(`${namespace}:${value}`).digest('hex')}`
}

async function consumeBucket(key: string, windowMinutes: number) {
  const rows = await prisma.$queryRaw<Array<{ request_count: number }>>(Prisma.sql`
    WITH expired AS (
      DELETE FROM login_rate_limits
      WHERE expires_at < CURRENT_TIMESTAMP
    ), current_window AS (
      SELECT date_bin(
        make_interval(mins => ${windowMinutes}),
        CURRENT_TIMESTAMP,
        TIMESTAMPTZ '2000-01-01 00:00:00+00'
      ) AS started_at
    ), consumed AS (
      INSERT INTO login_rate_limits(bucket_key, window_start, request_count, expires_at)
      SELECT ${key}, started_at, 1, started_at + make_interval(mins => ${windowMinutes})
      FROM current_window
      ON CONFLICT (bucket_key, window_start) DO UPDATE
      SET request_count = LEAST(login_rate_limits.request_count + 1, 1001),
          expires_at = EXCLUDED.expires_at
      RETURNING request_count
    )
    SELECT request_count FROM consumed
  `)
  return rows[0]?.request_count || 1001
}

export async function consumeLoginAllowance(headers: Headers, username: string) {
  const ipKey = bucketKey('ip', getSupportClientAddress(headers))
  const ipCount = await consumeBucket(ipKey, LOGIN_IP_WINDOW_MINUTES)
  if (ipCount > LOGIN_IP_WINDOW_LIMIT) return loginRateLimitDecision(ipCount, 0)

  const accountKey = bucketKey('account', normalizeLoginIdentifier(username))
  const accountCount = await consumeBucket(accountKey, LOGIN_ACCOUNT_WINDOW_MINUTES)
  return loginRateLimitDecision(ipCount, accountCount)
}

export async function resetLoginAccountFailures(username: string) {
  const accountKey = bucketKey('account', normalizeLoginIdentifier(username))
  await prisma.loginRateLimit.deleteMany({ where: { bucket_key: accountKey } })
}
