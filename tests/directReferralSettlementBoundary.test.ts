import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/lib/directReferral.ts", "utf8");
const registrationRoute = readFileSync("src/app/api/city/resellers/route.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260902149000_seal_direct_referral_settlements/migration.sql",
  "utf8",
);
const reserveLedger = readFileSync(
  "src/app/api/admin/commission-testing/reserve-ledger/route.ts",
  "utf8",
);

test("every registration path records an immutable Direct Referral decision", () => {
  assert.match(source, /INSERT INTO "direct_referral_settlement_events"/);
  assert.match(registrationRoute, /recordSystemDirectReferralRetention/);
  assert.match(registrationRoute, /settleDirectReferral/);
  assert.match(
    migration,
    /registration_financials_require_direct_referral_settlement[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  );
});

test("Direct Referral event snapshots locked package, eligibility, cap, and counters", () => {
  assert.match(source, /FOR UPDATE OF r, u FOR SHARE OF p/);
  for (const field of [
    "sponsor_bonus_snapshot",
    "source_allocation",
    "cap_enabled",
    "cap_limit",
    "settlement_day",
    "opening_daily_referral_count",
    "closing_daily_referral_count",
    "recipient_eligible",
    "payable_amount",
    "retained_amount",
  ]) {
    assert.ok(schema.includes(field), `missing settlement snapshot: ${field}`);
  }
  assert.match(migration, /NEW\."created_at" := transaction_timestamp\(\)/);
  assert.match(migration, /direct_referral_settlement_append_only/);
});

test("event is inserted before the sponsor counter reaches its claimed closing state", () => {
  const eventInsert = source.indexOf("await insertSettlementEvent");
  const counterUpdate = source.indexOf("UPDATE reseller_profiles", eventInsert);
  assert.ok(eventInsert >= 0 && counterUpdate > eventInsert);
  assert.match(
    migration,
    /effective_closing IS DISTINCT FROM NEW\."closing_daily_referral_count"/,
  );
});

test("payable and retained amounts exactly exhaust the sealed registration allocation", () => {
  assert.match(
    migration,
    /"payable_amount" \+ "retained_amount" = "source_allocation"/,
  );
  assert.match(migration, /normal_commission_id[\s\S]*retained_commission_id/);
  assert.match(migration, /Direct Referral source has commissions outside its exact settlement event/);
  assert.match(migration, /commissions_require_direct_referral_event/);
});

test("Hiroma root retention is explicit and cannot fabricate a member payment", () => {
  assert.match(source, /disposition: "retained_system_root"/);
  assert.match(
    migration,
    /retained_system_root[\s\S]*account\."username" = 'hiroma'[\s\S]*NEW\."payable_amount" IS DISTINCT FROM 0/,
  );
});

test("Admin integrity reporting exposes legacy and mismatched settlement evidence", () => {
  assert.match(reserveLedger, /legacy_direct_referral_settlements/);
  assert.match(reserveLedger, /unreconciled_direct_referral_settlements/);
  assert.match(reserveLedger, /Direct Referral decision:/);
});
