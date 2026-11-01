import type { Prisma } from '@prisma/client'

export type PackageBinaryCapRow = { user_id: string; enabled: boolean; cap: number; used_today: string | number; used_session?: string | number; session?: number; session_cap?: number }

// Caller holds each member's binary lock before reading usage or planning pairs.
export async function loadPackageBinaryDailyCaps(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, userIds: string[]) {
  if (!userIds.length) return []
  return tx.$queryRaw<PackageBinaryCapRow[]>`
    SELECT r.user_id::text,
           COALESCE(p.binary_pair_cap_enabled, true) AS enabled,
           COALESCE(p.daily_binary_pair_cap, 10)::int AS cap,
           COALESCE(d.used_pairs, 0)::text AS used_today,
           CASE WHEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::time < time '13:00' THEN 1 ELSE 2 END AS session,
           CASE WHEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::time < time '13:00'
             THEN GREATEST(1,COALESCE(p.daily_binary_pair_cap,10)/2)
             ELSE GREATEST(1,COALESCE(p.daily_binary_pair_cap,10)-COALESCE(p.daily_binary_pair_cap,10)/2) END AS session_cap,
           (COALESCE(v.session_used,0)+GREATEST(0,COALESCE(d.used_pairs,0)-COALESCE(v.recorded_used,0)))::text AS used_session
    FROM reseller_profiles r
    JOIN packages p ON p.id = r.package_id
    LEFT JOIN binary_daily_cap_usage d ON d.user_id=r.user_id
      AND d.pairing_day=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(e.payable_pairs+e.inactive_flashout_pairs),0) AS recorded_used,
        COALESCE(SUM(e.payable_pairs+e.inactive_flashout_pairs) FILTER (WHERE
          COALESCE(e.cap_session,CASE WHEN (e.created_at AT TIME ZONE 'Asia/Manila')::time < time '13:00' THEN 1 ELSE 2 END)
          =CASE WHEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::time < time '13:00' THEN 1 ELSE 2 END),0) AS session_used
      FROM binary_pair_events e WHERE e.recipient_user_id=r.user_id
        AND e.pairing_day=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
    ) v ON true
    WHERE r.user_id::text = ANY(${userIds}::text[])
  `
}

// This is a display cache only. A delayed older-day event cannot move it backward.
export async function applyPackageBinaryCapCache(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, userId: string, closingUsage: number) {
  if (!Number.isSafeInteger(closingUsage) || closingUsage < 0) throw new Error('Invalid daily pairing usage.')
  await tx.$executeRaw`
    UPDATE reseller_profiles
    SET daily_pairing_count = ${closingUsage},
        daily_pairing_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
    WHERE user_id = ${userId}
      AND (daily_pairing_date IS NULL OR daily_pairing_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date)
  `
}
