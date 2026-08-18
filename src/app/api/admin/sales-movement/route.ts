import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/app/lib/auth";
import prisma from "@/app/lib/prisma";

const parseDate = (value: string | null, end = false) => value && /^\d{4}-\d{2}-\d{2}$/.test(value)
  ? new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+08:00`) : null;
const allowedLevels = new Set(["all", "admin", "regional", "provincial", "city", "branch", "reseller"]);
const allowedStatuses = new Set(["all", "pending", "processing", "delivered", "cancelled"]);
const num = (value: unknown) => Number(value || 0) || 0;

type Summary = { orders: number; units: number; gross_sales: number; cost: number; gross_profit: number; collected: number; receivable: number; admin_gross_sales: number; admin_cost: number; admin_profit: number; exact_cost_rows: number; fallback_cost_rows: number };
type Breakdown = { key: string; label: string; orders: number; units: number; gross_sales: number; cost: number; gross_profit: number; collected: number; receivable: number };
type Movement = { id: string; order_id: string; order_number: string | null; event_at: Date; status: string; payment_status: string | null; order_type: string; seller_name: string; seller_username: string; seller_level: string; buyer_name: string; buyer_username: string; buyer_level: string; product_name: string; quantity: number; unit_price: number; unit_cost: number; gross_sales: number; cost: number; gross_profit: number; cost_quality: string; total_count: number };
type Activation = { activations: number; customer_payments: number; product_portion: number; product_cost: number; product_profit: number; pin_allocation: number; collected: number; receivable: number };
type ActivationBreakdown = { channel: string; activations: number; customer_payments: number; product_portion: number; product_cost: number; product_profit: number; pin_allocation: number };
type DistributorAnalysis = { sold_orders: number; sold_units: number; gross_sales: number; cost: number; gross_profit: number; collected: number; receivable: number; customers: number; purchase_orders: number; purchased_units: number; purchases: number; suppliers: number };
type AnalysisTrend = { period: Date; gross_sales: number; cost: number; gross_profit: number; purchases: number; units_sold: number; units_purchased: number };
type AreaAnalysis = { key: string; region_code: string | null; region_name: string | null; province_code: string | null; province_name: string | null; city_muni_code: string | null; city_muni_name: string | null; sellers: number; buyers: number; orders: number; units: number; gross_sales: number; cost: number; gross_profit: number; collected: number; receivable: number };

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const from = parseDate(req.nextUrl.searchParams.get("from")) || new Date(now.getFullYear(), now.getMonth(), 1);
  const to = parseDate(req.nextUrl.searchParams.get("to"), true) || now;
  if (from > to) return NextResponse.json({ error: "From date cannot be later than To date." }, { status: 400 });
  const buyerInput = req.nextUrl.searchParams.get("buyer_level") || "all";
  const sellerInput = req.nextUrl.searchParams.get("seller_level") || "all";
  const statusInput = req.nextUrl.searchParams.get("status") || "delivered";
  const buyerLevel = allowedLevels.has(buyerInput) ? buyerInput : "all";
  const sellerLevel = allowedLevels.has(sellerInput) ? sellerInput : "all";
  const status = allowedStatuses.has(statusInput) ? statusInput : "delivered";
  const search = (req.nextUrl.searchParams.get("search") || "").trim().toLowerCase().slice(0, 100);
  const distributorId = (req.nextUrl.searchParams.get("distributor_id") || "").trim().slice(0, 80);
  const productId = (req.nextUrl.searchParams.get("product_id") || "").trim().slice(0, 80);
  const regionCode = (req.nextUrl.searchParams.get("region_code") || "").trim().slice(0, 30);
  const provinceCode = (req.nextUrl.searchParams.get("province_code") || "").trim().slice(0, 30);
  const cityCode = (req.nextUrl.searchParams.get("city_code") || "").trim().slice(0, 30);
  const requestedPage = Number.parseInt(req.nextUrl.searchParams.get("page") || "1", 10);
  const requestedSize = Number.parseInt(req.nextUrl.searchParams.get("page_size") || "50", 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = Number.isSafeInteger(requestedSize) ? Math.min(Math.max(requestedSize, 1), 100) : 50;
  const offset = (page - 1) * pageSize;

  try {
    const [summaryRows, routeRows, sellerRows, productRows, movementRows, activationRows, activationBreakdown, distributorDirectory, productDirectory, distributorAnalysisRows, trendRows, areaRows, areaTrendRows] = await Promise.all([
      prisma.$queryRaw<Summary[]>`
        WITH movements AS (
          SELECT o.id order_id,o.status::text status,o.payment_status,oi.id,
            oi.quantity,oi.subtotal::float gross_sales,
            (COALESCE(oi.unit_acquisition_cost,im.unit_cost,p.cost_price)*oi.quantity)::float cost,
            CASE WHEN oi.unit_acquisition_cost IS NOT NULL THEN 'order_snapshot' WHEN im.unit_cost IS NOT NULL THEN 'movement_snapshot' ELSE 'catalog_fallback' END cost_quality,
            CASE WHEN sdp.dist_level='branch' THEN 'branch' ELSE seller.role::text END seller_level,
            CASE WHEN bdp.dist_level='branch' THEN 'branch' ELSE buyer.role::text END buyer_level
          FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id
          JOIN users seller ON seller.id=o.seller_id JOIN users buyer ON buyer.id=o.buyer_id
          LEFT JOIN distributor_profiles sdp ON sdp.user_id=seller.id LEFT JOIN distributor_profiles bdp ON bdp.user_id=buyer.id
          LEFT JOIN LATERAL (SELECT x.unit_cost FROM inventory_movements x WHERE x.order_id::text=o.id::text AND x.product_id::text=oi.product_id::text ORDER BY x.created_at DESC LIMIT 1) im ON true
          WHERE COALESCE(o.delivered_at,o.created_at)>=${from} AND COALESCE(o.delivered_at,o.created_at)<=${to}
            AND (${status}='all' OR o.status::text=${status})
            AND (${sellerLevel}='all' OR (CASE WHEN sdp.dist_level='branch' THEN 'branch' ELSE seller.role::text END)=${sellerLevel})
            AND (${buyerLevel}='all' OR (CASE WHEN bdp.dist_level='branch' THEN 'branch' ELSE buyer.role::text END)=${buyerLevel})
            AND (${search}='' OR LOWER(CONCAT_WS(' ',o.order_number,seller.full_name,seller.username,buyer.full_name,buyer.username,p.name)) LIKE ${`%${search}%`})
        ) SELECT COUNT(DISTINCT order_id)::int orders,COALESCE(SUM(quantity),0)::int units,
          COALESCE(SUM(gross_sales) FILTER(WHERE status='delivered'),0)::float gross_sales,
          COALESCE(SUM(cost) FILTER(WHERE status='delivered'),0)::float cost,
          COALESCE(SUM(gross_sales-cost) FILTER(WHERE status='delivered'),0)::float gross_profit,
          COALESCE(SUM(gross_sales) FILTER(WHERE status='delivered' AND payment_status='paid'),0)::float collected,
          COALESCE(SUM(gross_sales) FILTER(WHERE status='delivered' AND COALESCE(payment_status,'unpaid')<>'paid'),0)::float receivable,
          COALESCE(SUM(gross_sales) FILTER(WHERE status='delivered' AND seller_level='admin'),0)::float admin_gross_sales,
          COALESCE(SUM(cost) FILTER(WHERE status='delivered' AND seller_level='admin'),0)::float admin_cost,
          COALESCE(SUM(gross_sales-cost) FILTER(WHERE status='delivered' AND seller_level='admin'),0)::float admin_profit,
          COUNT(*) FILTER(WHERE cost_quality<>'catalog_fallback')::int exact_cost_rows,
          COUNT(*) FILTER(WHERE cost_quality='catalog_fallback')::int fallback_cost_rows FROM movements
      `,
      prisma.$queryRaw<Breakdown[]>`
        WITH x AS (SELECT o.id,oi.quantity,oi.subtotal::float gross_sales,(COALESCE(oi.unit_acquisition_cost,im.unit_cost,p.cost_price)*oi.quantity)::float cost,o.payment_status,
          CASE WHEN sdp.dist_level='branch' THEN 'branch' ELSE seller.role::text END seller_level,CASE WHEN bdp.dist_level='branch' THEN 'branch' ELSE buyer.role::text END buyer_level
          FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id JOIN users seller ON seller.id=o.seller_id JOIN users buyer ON buyer.id=o.buyer_id
          LEFT JOIN distributor_profiles sdp ON sdp.user_id=seller.id LEFT JOIN distributor_profiles bdp ON bdp.user_id=buyer.id
          LEFT JOIN LATERAL (SELECT m.unit_cost FROM inventory_movements m WHERE m.order_id::text=o.id::text AND m.product_id::text=oi.product_id::text ORDER BY m.created_at DESC LIMIT 1) im ON true
          WHERE o.status='delivered' AND COALESCE(o.delivered_at,o.created_at)>=${from} AND COALESCE(o.delivered_at,o.created_at)<=${to})
        SELECT seller_level||'_to_'||buyer_level key,INITCAP(seller_level)||' → '||INITCAP(buyer_level) label,COUNT(DISTINCT id)::int orders,SUM(quantity)::int units,
          SUM(gross_sales)::float gross_sales,SUM(cost)::float cost,SUM(gross_sales-cost)::float gross_profit,
          COALESCE(SUM(gross_sales) FILTER(WHERE payment_status='paid'),0)::float collected,COALESCE(SUM(gross_sales) FILTER(WHERE COALESCE(payment_status,'unpaid')<>'paid'),0)::float receivable
        FROM x WHERE (${sellerLevel}='all' OR seller_level=${sellerLevel}) AND (${buyerLevel}='all' OR buyer_level=${buyerLevel}) GROUP BY seller_level,buyer_level ORDER BY gross_sales DESC
      `,
      prisma.$queryRaw<Breakdown[]>`
        WITH x AS (SELECT o.id,oi.quantity,oi.subtotal::float gross_sales,(COALESCE(oi.unit_acquisition_cost,im.unit_cost,p.cost_price)*oi.quantity)::float cost,o.payment_status,
          CASE WHEN sdp.dist_level='branch' THEN 'branch' ELSE seller.role::text END key
          FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id JOIN users seller ON seller.id=o.seller_id
          LEFT JOIN distributor_profiles sdp ON sdp.user_id=seller.id LEFT JOIN LATERAL (SELECT m.unit_cost FROM inventory_movements m WHERE m.order_id::text=o.id::text AND m.product_id::text=oi.product_id::text ORDER BY m.created_at DESC LIMIT 1) im ON true
          WHERE o.status='delivered' AND COALESCE(o.delivered_at,o.created_at)>=${from} AND COALESCE(o.delivered_at,o.created_at)<=${to})
        SELECT key,INITCAP(key) label,COUNT(DISTINCT id)::int orders,SUM(quantity)::int units,SUM(gross_sales)::float gross_sales,SUM(cost)::float cost,SUM(gross_sales-cost)::float gross_profit,
          COALESCE(SUM(gross_sales) FILTER(WHERE payment_status='paid'),0)::float collected,COALESCE(SUM(gross_sales) FILTER(WHERE COALESCE(payment_status,'unpaid')<>'paid'),0)::float receivable
        FROM x GROUP BY key ORDER BY gross_sales DESC
      `,
      prisma.$queryRaw<Breakdown[]>`
        WITH x AS (SELECT p.id key,p.name label,o.id,oi.quantity,oi.subtotal::float gross_sales,(COALESCE(oi.unit_acquisition_cost,im.unit_cost,p.cost_price)*oi.quantity)::float cost,o.payment_status,
          CASE WHEN sdp.dist_level='branch' THEN 'branch' ELSE seller.role::text END seller_level,CASE WHEN bdp.dist_level='branch' THEN 'branch' ELSE buyer.role::text END buyer_level
          FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id JOIN users seller ON seller.id=o.seller_id JOIN users buyer ON buyer.id=o.buyer_id
          LEFT JOIN distributor_profiles sdp ON sdp.user_id=seller.id LEFT JOIN distributor_profiles bdp ON bdp.user_id=buyer.id
          LEFT JOIN LATERAL (SELECT m.unit_cost FROM inventory_movements m WHERE m.order_id::text=o.id::text AND m.product_id::text=oi.product_id::text ORDER BY m.created_at DESC LIMIT 1) im ON true
          WHERE o.status='delivered' AND COALESCE(o.delivered_at,o.created_at)>=${from} AND COALESCE(o.delivered_at,o.created_at)<=${to})
        SELECT key,label,COUNT(DISTINCT id)::int orders,SUM(quantity)::int units,SUM(gross_sales)::float gross_sales,SUM(cost)::float cost,SUM(gross_sales-cost)::float gross_profit,
          COALESCE(SUM(gross_sales) FILTER(WHERE payment_status='paid'),0)::float collected,COALESCE(SUM(gross_sales) FILTER(WHERE COALESCE(payment_status,'unpaid')<>'paid'),0)::float receivable FROM x
        WHERE (${sellerLevel}='all' OR seller_level=${sellerLevel}) AND (${buyerLevel}='all' OR buyer_level=${buyerLevel}) GROUP BY key,label ORDER BY gross_sales DESC
      `,
      prisma.$queryRaw<Movement[]>`
        WITH x AS (SELECT oi.id,o.id order_id,o.order_number,COALESCE(o.delivered_at,o.created_at) event_at,o.status::text,o.payment_status,o.order_type::text,
          seller.full_name seller_name,seller.username seller_username,CASE WHEN sdp.dist_level='branch' THEN 'branch' ELSE seller.role::text END seller_level,
          buyer.full_name buyer_name,buyer.username buyer_username,CASE WHEN bdp.dist_level='branch' THEN 'branch' ELSE buyer.role::text END buyer_level,p.name product_name,
          oi.quantity,oi.unit_price::float unit_price,COALESCE(oi.unit_acquisition_cost,im.unit_cost,p.cost_price)::float unit_cost,oi.subtotal::float gross_sales,
          (COALESCE(oi.unit_acquisition_cost,im.unit_cost,p.cost_price)*oi.quantity)::float cost,(oi.subtotal-COALESCE(oi.unit_acquisition_cost,im.unit_cost,p.cost_price)*oi.quantity)::float gross_profit,
          CASE WHEN oi.unit_acquisition_cost IS NOT NULL THEN 'order snapshot' WHEN im.unit_cost IS NOT NULL THEN 'movement snapshot' ELSE 'catalog fallback' END cost_quality
          FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id JOIN users seller ON seller.id=o.seller_id JOIN users buyer ON buyer.id=o.buyer_id
          LEFT JOIN distributor_profiles sdp ON sdp.user_id=seller.id LEFT JOIN distributor_profiles bdp ON bdp.user_id=buyer.id
          LEFT JOIN LATERAL (SELECT m.unit_cost FROM inventory_movements m WHERE m.order_id::text=o.id::text AND m.product_id::text=oi.product_id::text ORDER BY m.created_at DESC LIMIT 1) im ON true
          WHERE COALESCE(o.delivered_at,o.created_at)>=${from} AND COALESCE(o.delivered_at,o.created_at)<=${to})
        SELECT x.*,COUNT(*) OVER()::int total_count FROM x WHERE (${status}='all' OR status=${status}) AND (${sellerLevel}='all' OR seller_level=${sellerLevel}) AND (${buyerLevel}='all' OR buyer_level=${buyerLevel})
          AND (${search}='' OR LOWER(CONCAT_WS(' ',order_number,seller_name,seller_username,buyer_name,buyer_username,product_name)) LIKE ${`%${search}%`})
        ORDER BY event_at DESC,id DESC LIMIT ${pageSize} OFFSET ${offset}
      `,
      prisma.$queryRaw<Activation[]>`
        WITH a AS (SELECT customer_payment,product_acquisition_cost,reseller_value,pin_allocation,registration_profit,payment_status,COALESCE(paid_at,created_at) event_at FROM registration_financials
          UNION ALL SELECT customer_payment,product_acquisition_cost,reseller_value,pin_allocation,registration_profit,payment_status,COALESCE(paid_at,created_at) FROM upgrade_financials)
        SELECT COUNT(*)::int activations,COALESCE(SUM(customer_payment),0)::float customer_payments,COALESCE(SUM(reseller_value),0)::float product_portion,
          COALESCE(SUM(product_acquisition_cost),0)::float product_cost,COALESCE(SUM(registration_profit),0)::float product_profit,COALESCE(SUM(pin_allocation),0)::float pin_allocation,
          COALESCE(SUM(customer_payment) FILTER(WHERE payment_status='paid'),0)::float collected,COALESCE(SUM(customer_payment) FILTER(WHERE payment_status<>'paid'),0)::float receivable
        FROM a WHERE event_at>=${from} AND event_at<=${to}
      `,
      prisma.$queryRaw<ActivationBreakdown[]>`
        WITH a AS (SELECT registration_channel channel,customer_payment,product_acquisition_cost,reseller_value,pin_allocation,registration_profit,COALESCE(paid_at,created_at) event_at FROM registration_financials
          UNION ALL SELECT 'upgrade' channel,customer_payment,product_acquisition_cost,reseller_value,pin_allocation,registration_profit,COALESCE(paid_at,created_at) FROM upgrade_financials)
        SELECT channel,COUNT(*)::int activations,SUM(customer_payment)::float customer_payments,SUM(reseller_value)::float product_portion,SUM(product_acquisition_cost)::float product_cost,
          SUM(registration_profit)::float product_profit,SUM(pin_allocation)::float pin_allocation FROM a WHERE event_at>=${from} AND event_at<=${to} GROUP BY channel ORDER BY customer_payments DESC
      `,
      prisma.user.findMany({
        where: { distributor_profile: { isNot: null }, status: "active" },
        select: { id: true, full_name: true, username: true, role: true, distributor_profile: { select: { dist_level: true, coverage_area: true, region_code: true, region_name: true, province_code: true, province_name: true, city_muni_code: true, city_muni_name: true } } },
        orderBy: { full_name: "asc" },
      }),
      prisma.product.findMany({ where: { is_active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.$queryRaw<DistributorAnalysis[]>`
        WITH sold AS (
          SELECT o.id,oi.quantity,oi.subtotal::float gross_sales,(COALESCE(oi.unit_acquisition_cost,im.unit_cost,p.cost_price)*oi.quantity)::float cost,o.payment_status,o.buyer_id
          FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id
          LEFT JOIN LATERAL (SELECT m.unit_cost FROM inventory_movements m WHERE m.order_id::text=o.id::text AND m.product_id::text=oi.product_id::text ORDER BY m.created_at DESC LIMIT 1) im ON true
          WHERE o.status='delivered' AND o.seller_id::text=${distributorId} AND COALESCE(o.delivered_at,o.created_at)>=${from} AND COALESCE(o.delivered_at,o.created_at)<=${to}
            AND (${productId}='' OR oi.product_id::text=${productId})
        ), bought AS (
          SELECT o.id,oi.quantity,oi.subtotal::float purchases,o.seller_id
          FROM orders o JOIN order_items oi ON oi.order_id=o.id
          WHERE o.status='delivered' AND o.buyer_id::text=${distributorId} AND COALESCE(o.delivered_at,o.created_at)>=${from} AND COALESCE(o.delivered_at,o.created_at)<=${to}
            AND (${productId}='' OR oi.product_id::text=${productId})
        )
        SELECT (SELECT COUNT(DISTINCT id)::int FROM sold) sold_orders,(SELECT COALESCE(SUM(quantity),0)::int FROM sold) sold_units,
          (SELECT COALESCE(SUM(gross_sales),0)::float FROM sold) gross_sales,(SELECT COALESCE(SUM(cost),0)::float FROM sold) cost,
          (SELECT COALESCE(SUM(gross_sales-cost),0)::float FROM sold) gross_profit,
          (SELECT COALESCE(SUM(gross_sales) FILTER(WHERE payment_status='paid'),0)::float FROM sold) collected,
          (SELECT COALESCE(SUM(gross_sales) FILTER(WHERE COALESCE(payment_status,'unpaid')<>'paid'),0)::float FROM sold) receivable,
          (SELECT COUNT(DISTINCT buyer_id)::int FROM sold) customers,(SELECT COUNT(DISTINCT id)::int FROM bought) purchase_orders,
          (SELECT COALESCE(SUM(quantity),0)::int FROM bought) purchased_units,(SELECT COALESCE(SUM(purchases),0)::float FROM bought) purchases,
          (SELECT COUNT(DISTINCT seller_id)::int FROM bought) suppliers
      `,
      prisma.$queryRaw<AnalysisTrend[]>`
        WITH months AS (
          SELECT DATE_TRUNC('month',COALESCE(o.delivered_at,o.created_at)) period,
            CASE WHEN o.seller_id::text=${distributorId} THEN oi.subtotal::float ELSE 0 END gross_sales,
            CASE WHEN o.seller_id::text=${distributorId} THEN (COALESCE(oi.unit_acquisition_cost,im.unit_cost,p.cost_price)*oi.quantity)::float ELSE 0 END cost,
            CASE WHEN o.buyer_id::text=${distributorId} THEN oi.subtotal::float ELSE 0 END purchases,
            CASE WHEN o.seller_id::text=${distributorId} THEN oi.quantity ELSE 0 END units_sold,
            CASE WHEN o.buyer_id::text=${distributorId} THEN oi.quantity ELSE 0 END units_purchased
          FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id
          LEFT JOIN LATERAL (SELECT m.unit_cost FROM inventory_movements m WHERE m.order_id::text=o.id::text AND m.product_id::text=oi.product_id::text ORDER BY m.created_at DESC LIMIT 1) im ON true
          WHERE o.status='delivered' AND (o.seller_id::text=${distributorId} OR o.buyer_id::text=${distributorId})
            AND COALESCE(o.delivered_at,o.created_at)>=${from} AND COALESCE(o.delivered_at,o.created_at)<=${to}
            AND (${productId}='' OR oi.product_id::text=${productId})
        ) SELECT period,SUM(gross_sales)::float gross_sales,SUM(cost)::float cost,SUM(gross_sales-cost)::float gross_profit,SUM(purchases)::float purchases,
          SUM(units_sold)::int units_sold,SUM(units_purchased)::int units_purchased FROM months GROUP BY period ORDER BY period
      `,
      prisma.$queryRaw<AreaAnalysis[]>`
        WITH x AS (
          SELECT o.id,o.seller_id,o.buyer_id,oi.quantity,oi.subtotal::float gross_sales,(COALESCE(oi.unit_acquisition_cost,im.unit_cost,p.cost_price)*oi.quantity)::float cost,o.payment_status,
            dp.region_code,dp.region_name,dp.province_code,dp.province_name,dp.city_muni_code,dp.city_muni_name
          FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id
          JOIN distributor_profiles dp ON dp.user_id=o.seller_id
          LEFT JOIN LATERAL (SELECT m.unit_cost FROM inventory_movements m WHERE m.order_id::text=o.id::text AND m.product_id::text=oi.product_id::text ORDER BY m.created_at DESC LIMIT 1) im ON true
          WHERE o.status='delivered' AND COALESCE(o.delivered_at,o.created_at)>=${from} AND COALESCE(o.delivered_at,o.created_at)<=${to}
            AND (${regionCode}='' OR dp.region_code=${regionCode}) AND (${provinceCode}='' OR dp.province_code=${provinceCode}) AND (${cityCode}='' OR dp.city_muni_code=${cityCode})
            AND (${productId}='' OR oi.product_id::text=${productId})
        ) SELECT CONCAT_WS(':',COALESCE(region_code,''),COALESCE(province_code,''),COALESCE(city_muni_code,'')) key,region_code,region_name,province_code,province_name,city_muni_code,city_muni_name,
          COUNT(DISTINCT seller_id)::int sellers,COUNT(DISTINCT buyer_id)::int buyers,COUNT(DISTINCT id)::int orders,SUM(quantity)::int units,
          SUM(gross_sales)::float gross_sales,SUM(cost)::float cost,SUM(gross_sales-cost)::float gross_profit,
          COALESCE(SUM(gross_sales) FILTER(WHERE payment_status='paid'),0)::float collected,COALESCE(SUM(gross_sales) FILTER(WHERE COALESCE(payment_status,'unpaid')<>'paid'),0)::float receivable
        FROM x GROUP BY region_code,region_name,province_code,province_name,city_muni_code,city_muni_name ORDER BY gross_sales DESC
      `,
      prisma.$queryRaw<AnalysisTrend[]>`
        WITH x AS (
          SELECT DATE_TRUNC('month',COALESCE(o.delivered_at,o.created_at)) period,oi.quantity,oi.subtotal::float gross_sales,
            (COALESCE(oi.unit_acquisition_cost,im.unit_cost,p.cost_price)*oi.quantity)::float cost
          FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id
          JOIN distributor_profiles dp ON dp.user_id=o.seller_id
          LEFT JOIN LATERAL (SELECT m.unit_cost FROM inventory_movements m WHERE m.order_id::text=o.id::text AND m.product_id::text=oi.product_id::text ORDER BY m.created_at DESC LIMIT 1) im ON true
          WHERE o.status='delivered' AND COALESCE(o.delivered_at,o.created_at)>=${from} AND COALESCE(o.delivered_at,o.created_at)<=${to}
            AND (${regionCode}='' OR dp.region_code=${regionCode}) AND (${provinceCode}='' OR dp.province_code=${provinceCode}) AND (${cityCode}='' OR dp.city_muni_code=${cityCode})
            AND (${productId}='' OR oi.product_id::text=${productId})
        ) SELECT period,SUM(gross_sales)::float gross_sales,SUM(cost)::float cost,SUM(gross_sales-cost)::float gross_profit,0::float purchases,
          SUM(quantity)::int units_sold,0::int units_purchased FROM x GROUP BY period ORDER BY period
      `,
    ]);
    const summary = summaryRows[0] || {} as Summary;
    const activation = activationRows[0] || {} as Activation;
    const distributorAnalysis = distributorAnalysisRows[0] || {} as DistributorAnalysis;
    const selectedDistributor = distributorDirectory.find(item => item.id === distributorId) || null;
    const areaDirectory = distributorDirectory.filter(item => {
      const profile = item.distributor_profile;
      return profile && (!regionCode || profile.region_code === regionCode) && (!provinceCode || profile.province_code === provinceCode) && (!cityCode || profile.city_muni_code === cityCode);
    });
    const areaCoverage = areaDirectory.reduce((counts, item) => {
      const level = item.distributor_profile?.dist_level || "unknown";
      counts[level] = (counts[level] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);
    const areaSummary = areaRows.reduce((total, row) => ({
      sellers: total.sellers + num(row.sellers), buyers: total.buyers + num(row.buyers), orders: total.orders + num(row.orders), units: total.units + num(row.units),
      gross_sales: total.gross_sales + num(row.gross_sales), cost: total.cost + num(row.cost), gross_profit: total.gross_profit + num(row.gross_profit),
      collected: total.collected + num(row.collected), receivable: total.receivable + num(row.receivable),
    }), { sellers: 0, buyers: 0, orders: 0, units: 0, gross_sales: 0, cost: 0, gross_profit: 0, collected: 0, receivable: 0 });
    const totalCount = num(movementRows[0]?.total_count);
    return NextResponse.json({ range: { from, to }, filters: { buyer_level: buyerLevel, seller_level: sellerLevel, status, search, distributor_id: distributorId, product_id: productId, region_code: regionCode, province_code: provinceCode, city_code: cityCode },
      summary: Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, num(value)])), routes: routeRows, liquidation: sellerRows,
      products: productRows, movements: movementRows, activation: Object.fromEntries(Object.entries(activation).map(([key, value]) => [key, num(value)])), activation_breakdown: activationBreakdown,
      directory: { distributors: distributorDirectory, products: productDirectory }, selected_distributor: selectedDistributor,
      distributor_analysis: Object.fromEntries(Object.entries(distributorAnalysis).map(([key, value]) => [key, num(value)])), distributor_trend: trendRows,
      area_summary: areaSummary, area_analysis: areaRows, area_trend: areaTrendRows, area_coverage: areaCoverage,
      pagination: { page, page_size: pageSize, total_count: totalCount, total_pages: Math.max(1, Math.ceil(totalCount / pageSize)) },
      notes: { chain_turnover: "Network turnover counts each delivered seller-to-buyer transaction. Do not treat it as unique end-customer revenue.",
        company_sales: "Admin product sales are the delivered transactions where Admin is the seller. Activation PIN allocation is reported separately to prevent double counting.",
        cost: "Cost uses the order snapshot first, then Admin movement snapshot, and only falls back to the current catalog cost for legacy rows.",
        read_only: "This module is read-only and does not change orders, inventory, PINs, wallets, or commissions." } });
  } catch (error) {
    console.error("[SALES MOVEMENT]", error);
    return NextResponse.json({ error: "Unable to load sales and product movement." }, { status: 500 });
  }
}
