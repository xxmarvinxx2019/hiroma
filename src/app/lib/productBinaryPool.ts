/** Allocate a weekly Product Binary pool in integer centavos. */
export function calculateProductBinaryPool(
  qualifiedBottles: bigint,
  maxRateCentavos: bigint,
  members: readonly { userId: string; pairs: bigint }[],
) {
  if (qualifiedBottles < BigInt(0) || maxRateCentavos < BigInt(0)) throw new Error('Invalid pool inputs.')
  const ids = new Set<string>()
  let totalPairs = BigInt(0)
  for (const member of members) {
    if (member.pairs < BigInt(0) || ids.has(member.userId)) throw new Error('Invalid member pair totals.')
    ids.add(member.userId)
    totalPairs += member.pairs
  }

  const poolCentavos = qualifiedBottles * BigInt(500)
  const fullPayout = totalPairs * maxRateCentavos
  const distributable = poolCentavos < fullPayout ? poolCentavos : fullPayout
  const rateDenominator = totalPairs || BigInt(1)

  const allocations = members.map(({ userId, pairs }) => ({
    userId,
    pairs,
    // Round down at the member level so the sum can never exceed the pool.
    amountCentavos: pairs * distributable / rateDenominator,
  }))

  return {
    poolCentavos,
    totalPairs,
    rateNumerator: distributable,
    rateDenominator,
    allocations,
  }
}

const DAY_MS = 86_400_000
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000

/** A Manila week starts on Monday at midnight and ends at the next Monday. */
export function getProductBinaryPoolWeek(at: Date) {
  const manila = new Date(at.getTime() + MANILA_OFFSET_MS)
  const daysSinceMonday = (manila.getUTCDay() + 6) % 7
  const start = Date.UTC(
    manila.getUTCFullYear(), manila.getUTCMonth(), manila.getUTCDate() - daysSinceMonday,
  ) - MANILA_OFFSET_MS
  return {
    start: new Date(start),
    endExclusive: new Date(start + 7 * DAY_MS),
  }
}
