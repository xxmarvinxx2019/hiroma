import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/admin/commission-testing/flushout-report/route.ts", "utf8");
const page = readFileSync("src/app/dashboard/admin/commission-testing/flushout-report/page.tsx", "utf8");

test("flushout report is admin-only and read-only", () => {
  assert.match(route, /user\.role !== "admin"/);
  assert.match(route, /c\.is_pair_overflow=true/);
  assert.doesNotMatch(route, /prisma\.(commission|wallet)\.(create|update|delete|upsert)/);
  assert.doesNotMatch(route, /\$executeRaw/);
});

test("financial truth remains separate from exact event enrichment", () => {
  assert.match(route, /commissions as the financial source of truth/);
  assert.match(route, /LEFT JOIN binary_pair_events e ON e\.flashout_commission_id=c\.id/);
  assert.match(route, /CASE WHEN e\.id IS NOT NULL OR c\.type='deactivation_wallet_transfer' THEN 'exact' ELSE 'legacy' END data_quality/);
  assert.match(route, /c\.type='deactivation_wallet_transfer' OR \(c\.type='binary_pairing' AND COALESCE\(c\.points,0\)=0\)/);
  assert.match(route, /exact_coverage_percent/);
});

test("ledger filters before bounded pagination", () => {
  const filterPosition = route.indexOf("WHERE (${category}='all'");
  const limitPosition = route.indexOf("LIMIT ${pageSize} OFFSET ${offset}");
  assert.ok(filterPosition > -1 && limitPosition > filterPosition);
  assert.match(route, /Math\.min\(Math\.max\(requestedPageSize, 1\), 100\)/);
});

test("admin UI explains legacy quality and exposes readable audit controls", () => {
  assert.match(page, /Historical data note:/);
  assert.match(page, /All data quality/);
  assert.match(page, /Flushout event ledger/);
  assert.match(page, /How to read this report/);
});
