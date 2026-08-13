import prisma from '../src/app/lib/prisma'

async function main() {
  const rows = await prisma.$queryRaw<Array<{
    lots: number; allocated: number; available: number; funded: number; unfunded: number
  }>>`
    SELECT
      (SELECT COUNT(*) FROM product_binary_funding_lots)::int lots,
      (SELECT COALESCE(SUM(original_amount),0) FROM product_binary_funding_lots)::float allocated,
      (SELECT COALESCE(SUM(remaining_amount),0) FROM product_binary_funding_lots)::float available,
      (SELECT COALESCE(SUM(amount),0) FROM product_binary_funding_consumptions WHERE is_unfunded=false)::float funded,
      (SELECT COALESCE(SUM(amount),0) FROM product_binary_funding_consumptions WHERE is_unfunded=true)::float unfunded
  `
  console.log(JSON.stringify(rows[0], null, 2))
}

main().finally(() => prisma.$disconnect())
