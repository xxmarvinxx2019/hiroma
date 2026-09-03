import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "src/app/api/admin/commission-testing/reserve-ledger/route.ts",
  "utf8",
);
const page = readFileSync(
  "src/app/dashboard/admin/commission-testing/reserve-ledger/page.tsx",
  "utf8",
);

test("quarantined Product Binary history is never reported as available reserve", () => {
  assert.match(
    route,
    /SUM\(original_amount\) FROM product_binary_funding_lots WHERE reconciliation_status='exact'/,
  );
  assert.match(
    route,
    /SUM\(remaining_amount\) FROM product_binary_funding_lots WHERE reconciliation_status='exact'/,
  );
  assert.match(route, /Legacy Product Binary source quarantined; not spendable funding/);
  assert.match(route, /COALESCE\(p\.order_id,p\.inventory_movement_id::text,p\.id::text\)/);
});

test("Direct Referral availability is based on immutable decisions, not only paid rows", () => {
  assert.match(route, /SUM\(source_allocation\) FROM direct_referral_settlement_events/);
  assert.match(route, /num\(d\.allocated\)-num\(d\.decided\)/);
  assert.match(route, /SUM\(retained_amount\) FROM direct_referral_settlement_events/);
  assert.match(page, /Direct Retained/);
});
