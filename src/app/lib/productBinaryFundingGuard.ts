import type { Prisma } from '@prisma/client'

type FundingRow = {
  funded_amount: string | number | null
  unfunded_amount: string | number | null
}

function toCentavos(value: unknown) {
  const amount = Number(value)
  if (!Number.isFinite(amount))
    throw new Error('Product Binary funding state is invalid.')
  return Math.round(amount * 100)
}

export async function assertProductBinaryCommissionIsFullyFunded(
  tx: Prisma.TransactionClient,
  commissionId: string,
  commissionAmount: number,
) {
  const [funding] = await tx.$queryRaw<FundingRow[]>`
    SELECT
      COALESCE(SUM("amount") FILTER (WHERE "is_unfunded" = false), 0)::text AS "funded_amount",
      COALESCE(SUM("amount") FILTER (WHERE "is_unfunded" = true), 0)::text AS "unfunded_amount"
    FROM "product_binary_funding_consumptions"
    WHERE "commission_id" = ${commissionId}
  `
  const requiredCentavos = toCentavos(commissionAmount)
  const fundedCentavos = toCentavos(funding?.funded_amount ?? 0)
  const unfundedCentavos = toCentavos(funding?.unfunded_amount ?? 0)

  if (fundedCentavos !== requiredCentavos || unfundedCentavos !== 0)
    throw new Error('Product Binary commission is not fully funded by reserve.')
}
