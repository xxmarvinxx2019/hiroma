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
  // Keep allocation state outside `users`. A deleted account must never make its
  // public Member ID available to a later registration and an old QR code. The
  // issuance tombstone is created in the same statement as the high-water
  // increment, so no allocated ID can be omitted or reused.
  const rows = await tx.$queryRaw<Array<{
    member_id: string
    allocated_sequence: number
  }>>`
    WITH allocated AS (
      INSERT INTO member_id_sequences (year, last_sequence)
      VALUES (${year}, 1)
      ON CONFLICT (year) DO UPDATE
        SET last_sequence = member_id_sequences.last_sequence + 1
      RETURNING last_sequence AS allocated_sequence
    ), issued AS (
      INSERT INTO member_id_issuances (
        member_id, year, sequence, evidence_source, allocated_at
      )
      SELECT
        ${MEMBER_ID_PREFIX} || '-' || ${year} || '-' ||
          lpad(allocated_sequence::text, 6, '0'),
        ${year}, allocated_sequence, 'runtime_allocation', CURRENT_TIMESTAMP
      FROM allocated
      RETURNING member_id, sequence AS allocated_sequence
    )
    SELECT member_id, allocated_sequence FROM issued
  `

  const nextSequence = Number(rows[0]?.allocated_sequence)
  const memberId = rows[0]?.member_id
  if (
    !Number.isSafeInteger(nextSequence) ||
    nextSequence < 1 ||
    memberId !== `${MEMBER_ID_PREFIX}-${year}-${String(nextSequence).padStart(6, '0')}`
  ) {
    throw new Error('Unable to allocate a permanent Member ID sequence.')
  }
  return memberId
}
