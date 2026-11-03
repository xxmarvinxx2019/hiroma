import type { Prisma } from '@prisma/client'

export type PackageBinaryCapRow = { user_id: string; enabled: boolean; cap: number; used_today: string | number; used_session?: string | number; session?: number; session_cap?: number; mode?: 'two_sessions' | 'daily_anytime'; policy_id?: string | null; cutoff?: string | null; carryover_enabled?: boolean; carryover_limit?: number; carryover_policy_id?: string | null }

// Caller holds each member's binary lock before reading usage or planning pairs.
export async function loadPackageBinaryDailyCaps(tx: Pick<Prisma.TransactionClient, '$queryRaw'>, userIds: string[]) {
  if (!userIds.length) return []
  return tx.$queryRaw<PackageBinaryCapRow[]>`
    SELECT r.user_id::text,s.enabled,s.cap,s.mode,s.policy_id,s.cutoff,s.session,s.session_cap,
           s.used_today::text,s.used_session::text,s.carryover_enabled,s.carryover_limit,s.carryover_policy_id
    FROM reseller_profiles r
    CROSS JOIN LATERAL package_binary_cap_state_v2(r.package_id,r.user_id,CURRENT_TIMESTAMP) s
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
