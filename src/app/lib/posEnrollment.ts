import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import prisma from '@/app/lib/prisma'

export const POS_ENROLLMENT_TTL_MS = 15 * 60 * 1000

export function normalizePosEnrollmentCode(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) : ''
}

export function hashPosEnrollmentCode(code: string): string {
  return createHash('sha256').update(normalizePosEnrollmentCode(code)).digest('hex')
}

export function createPosEnrollmentCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(12)
  const raw = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
  return raw.match(/.{1,4}/g)!.join('-')
}

export async function consumePosEnrollmentAttempt(bucketKey: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ request_count: number }>>`
    INSERT INTO pos_enrollment_rate_limits(bucket_key, window_start, request_count, expires_at)
    VALUES (${bucketKey}, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP + INTERVAL '15 minutes')
    ON CONFLICT (bucket_key) DO UPDATE SET
      window_start = CASE WHEN pos_enrollment_rate_limits.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP ELSE pos_enrollment_rate_limits.window_start END,
      request_count = CASE WHEN pos_enrollment_rate_limits.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE LEAST(pos_enrollment_rate_limits.request_count + 1, 11) END,
      expires_at = CASE WHEN pos_enrollment_rate_limits.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE pos_enrollment_rate_limits.expires_at END
    RETURNING request_count
  `
  return (rows[0]?.request_count || 11) <= 10
}
