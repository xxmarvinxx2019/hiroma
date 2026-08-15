import { Prisma } from '@prisma/client'
import prisma from '@/app/lib/prisma'
import { getSupportClientAddress, supportClientFingerprint } from '@/app/lib/supportAbuseProtection'
import { PUBLIC_VERIFICATION_WINDOW_LIMIT, PUBLIC_VERIFICATION_WINDOW_MINUTES } from '@/app/lib/publicVerificationPolicy'

export function publicVerificationFingerprint(headers: Headers) {
  return `verification:${supportClientFingerprint(getSupportClientAddress(headers))}`
}

export async function consumePublicVerificationAllowance(headers: Headers) {
  const bucketKey = publicVerificationFingerprint(headers)
  const rows = await prisma.$queryRaw<Array<{ request_count: number }>>(Prisma.sql`
    WITH expired AS (
      DELETE FROM public_verification_rate_limits
      WHERE expires_at < CURRENT_TIMESTAMP
    ), current_window AS (
      SELECT date_bin(
        INTERVAL '${Prisma.raw(String(PUBLIC_VERIFICATION_WINDOW_MINUTES))} minutes',
        CURRENT_TIMESTAMP,
        TIMESTAMPTZ '2000-01-01 00:00:00+00'
      ) AS started_at
    ), consumed AS (
      INSERT INTO public_verification_rate_limits(bucket_key, window_start, request_count, expires_at)
      SELECT ${bucketKey}, started_at, 1, started_at + INTERVAL '10 minutes'
      FROM current_window
      ON CONFLICT (bucket_key, window_start) DO UPDATE
      SET request_count = LEAST(public_verification_rate_limits.request_count + 1, 31)
      RETURNING request_count
    )
    SELECT request_count FROM consumed
  `)
  return (rows[0]?.request_count || PUBLIC_VERIFICATION_WINDOW_LIMIT + 1) <= PUBLIC_VERIFICATION_WINDOW_LIMIT
}
