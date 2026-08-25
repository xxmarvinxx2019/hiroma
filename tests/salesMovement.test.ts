import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../src/app/api/admin/sales-movement/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/app/dashboard/admin/sales-movement/page.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../src/app/dashboard/admin/layout.tsx", import.meta.url), "utf8");
const permissions = readFileSync(new URL("../src/app/lib/staffPermissions.ts", import.meta.url), "utf8");

test("sales movement reporting is admin-only and read-only", () => {
  assert.match(route, /user\.role !== "admin"/);
  assert.doesNotMatch(route, /prisma\.[\w]+\.(create|update|delete|upsert)/);
  assert.doesNotMatch(route, /\$executeRaw/);
  assert.match(route, /does not change orders, inventory, PINs, wallets, or commissions/);
});

test("costing prioritizes immutable snapshots before the legacy catalog fallback", () => {
  assert.match(route, /COALESCE\(oi\.unit_acquisition_cost,im\.unit_cost,p\.cost_price\)/);
  assert.match(route, /order_snapshot/);
  assert.match(route, /movement_snapshot/);
  assert.match(route, /catalog_fallback/);
  assert.match(route, /x\.order_id::text=o\.id::text/);
});

test("company contribution is separated from network chain turnover", () => {
  assert.match(route, /admin_gross_sales/);
  assert.match(route, /pin_allocation/);
  assert.match(route, /Network turnover counts each delivered seller-to-buyer transaction/);
  assert.match(page, /Admin product gross profit \+ PIN allocation/);
  assert.match(page, /not unique\s+end-customer revenue/);
});

test("movement details are filtered before bounded pagination", () => {
  const filterPosition = route.indexOf("AND (${search}='' OR LOWER");
  const limitPosition = route.indexOf("LIMIT ${pageSize} OFFSET ${offset}");
  assert.ok(filterPosition > -1 && limitPosition > filterPosition);
  assert.match(route, /Math\.min\(Math\.max\(requestedSize, 1\), 100\)/);
});

test("admin navigation and staff report permission expose the module", () => {
  assert.match(layout, /Sales & Movement/);
  assert.match(layout, /\/dashboard\/admin\/sales-movement/);
  assert.match(permissions, /\/api\/admin\/sales-movement/);
  assert.match(permissions, /'reports'/);
});

test("UI exposes movement, activation, and liquidation views with accounting caveats", () => {
  assert.match(page, /Product Movement/);
  assert.match(page, /PIN & Activation/);
  assert.match(page, /Sales liquidation by seller level/);
  assert.match(page, /Full opening\/closing physical stock reconciliation/);
});

test("future analysis supports exact distributor and standardized geographic filters", () => {
  assert.match(route, /distributor_id/);
  assert.match(route, /region_code/);
  assert.match(route, /province_code/);
  assert.match(route, /city_code/);
  assert.match(route, /o\.seller_id::text=\$\{distributorId\}/);
  assert.match(route, /o\.buyer_id::text=\$\{distributorId\}/);
  assert.match(route, /dp\.region_code=\$\{regionCode\}/);
  assert.match(route, /dp\.province_code=\$\{provinceCode\}/);
  assert.match(route, /dp\.city_muni_code=\$\{cityCode\}/);
});

test("analysis UI separates distributor sales and purchases and explains area attribution", () => {
  assert.match(page, /Distributor Analysis/);
  assert.match(page, /Area Analysis/);
  assert.match(page, /Filter by distributor type, then search by name, username, or\s+registered coverage area/);
  assert.match(page, /Actual Sales follows the seller\/outlet/);
  assert.match(page, /Admin-direct sales are reported separately in Overview\s+because Admin has no single geographic coverage area/);
});

test("distributor analysis uses a scalable type filter and searchable area-aware combobox", () => {
  assert.match(page, /Distributor type/);
  assert.match(page, /All distributor types/);
  assert.match(page, /Regional Distributor/);
  assert.match(page, /Provincial Distributor/);
  assert.match(page, /City Distributor/);
  assert.match(page, /Search distributor or area/);
  assert.match(page, /profile\?\.coverage_area/);
  assert.match(page, /profile\?\.region_name/);
  assert.match(page, /profile\?\.province_name/);
  assert.match(page, /profile\?\.city_muni_name/);
  assert.match(page, /role="combobox"/);
  assert.match(page, /role="listbox"/);
});
