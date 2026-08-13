import { Prisma } from '@prisma/client'

const MEMBER_ID_PREFIX = 'HRM'
const MANILA_TIME_ZONE = 'Asia/Manila'

function memberIdYear(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
  }).format(date)
}

/**
 * Creates a public, permanent member identifier such as HRM-2026-000001.
 * The advisory lock serializes number allocation per year so concurrent
 * registrations cannot be issued the same member ID.
 */
export async function generateMemberId(
  tx: Prisma.TransactionClient,
  registeredAt = new Date(),
): Promise<string> {
  const year = memberIdYear(registeredAt)
  const prefix = `${MEMBER_ID_PREFIX}-${year}-`

  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`hiroma-member-id-${year}`}))
  `

  const rows = await tx.$queryRaw<Array<{ highest_sequence: number | bigint | null }>>`
    SELECT MAX(split_part(member_id, '-', 3)::integer) AS highest_sequence
    FROM users
    WHERE member_id LIKE ${`${prefix}%`}
      AND member_id ~ ${`^${MEMBER_ID_PREFIX}-[0-9]{4}-[0-9]{6}$`}
  `

  const nextSequence = Number(rows[0]?.highest_sequence ?? 0) + 1
  return `${prefix}${String(nextSequence).padStart(6, '0')}`
}
