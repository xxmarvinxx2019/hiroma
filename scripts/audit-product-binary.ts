import "dotenv/config";
import prisma from "../src/app/lib/prisma";

async function main() {
  const [packages, ranks, products, commissions, deliveredOrders] =
    await Promise.all([
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT id::text, name, point_php_value::float,
               pairing_bonus_value::float, product_binary_cap_enabled,
               daily_product_pairing_cap
        FROM packages ORDER BY price
      `,
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT r.name, r.sequence, r.required_pu, r.pair_income::float,
               p.name package
        FROM ranks r JOIN packages p ON p.id=r.package_id
        ORDER BY p.price,r.sequence
      `,
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT name, pu_value, binary_eligible, cost_price::float,
               regional_price::float, provincial_price::float,
               city_price::float, reseller_price::float
        FROM products ORDER BY name
      `,
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT type::text, is_pair_overflow, COUNT(*)::int events,
               COALESCE(SUM(amount),0)::float amount
        FROM commissions WHERE type='sponsor_point'
        GROUP BY 1,2 ORDER BY 2
      `,
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT COUNT(DISTINCT o.id)::int orders,
               COALESCE(SUM(oi.quantity * p.pu_value),0)::int pu,
               COALESCE(SUM(oi.quantity),0)::int units
        FROM orders o JOIN order_items oi ON oi.order_id=o.id
        JOIN products p ON p.id=oi.product_id
        JOIN users u ON u.id=o.buyer_id
        WHERE o.status='delivered' AND u.role='reseller'
          AND p.binary_eligible=true AND p.pu_value > 0
      `,
    ]);
  console.log(
    JSON.stringify(
      { packages, ranks, products, commissions, deliveredOrders },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
